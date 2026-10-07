//! Not in ln: the wasm-bindgen API that the web worker (../worker.js) calls.
//!
//! A `Job` is one render that can run in slices. `new` builds the scene of
//! an example and compiles it. Each `next(budget)` call renders paths until
//! about `budget` visibility rays were cast, and returns the new 2D paths.
//! The worker posts each slice to the page, so lines show while the render
//! runs, and a new request can stop the old job between two slices. The
//! order of the paths is the order of ln Scene.Render.
//!
//! The path buffer (Float32Array): [count, n0, x, y, x, y, ..., n1, ...]
//! with x, y in image units (0..width, 0..height), y up, as ln gives them.
//!
//! The camera array: [eye x y z, center x y z, up x y z, fovy]. An empty
//! array takes the camera of the example.
//!
//! GREP MAP
//!   grep -n 'pub fn catalog'     the example table as JSON
//!   grep -n 'pub fn next'        one slice of a render
//!   grep -n 'pub fn render_svg'  a whole render as SVG (Paths to_svg)

use crate::examples::{all, code_extract, find, group_of, Built, Camera, Example, Params};
use crate::matrix::Matrix;
use crate::path::{Path, PathsExt, SvgStyle};
use crate::scene::{screen_matrix, Scene};
use crate::vector::{v3, Vector};
use wasm_bindgen::prelude::*;

fn js_str(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => {}
            '\t' => o.push_str("  "),
            c if (c as u32) < 0x20 => o.push(' '),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn vec3(v: Vector) -> String {
    format!("[{},{},{}]", v.x, v.y, v.z)
}

fn example_json(e: &Example) -> String {
    let params: Vec<String> = e
        .params
        .iter()
        .map(|p| {
            let opts: Vec<String> = p.options.iter().map(|o| js_str(o)).collect();
            format!(
                "{{\"key\":{},\"label\":{},\"min\":{},\"max\":{},\"step\":{},\"value\":{},\"options\":[{}]}}",
                js_str(p.key),
                js_str(p.label),
                p.min,
                p.max,
                p.step,
                p.value,
                opts.join(",")
            )
        })
        .collect();
    let c = e.camera;
    format!(
        "{{\"key\":{},\"group\":{},\"title\":{},\"source\":{},\"blurb\":{},\"width\":{},\"height\":{},\"step\":{},\"cost\":{},\"camera\":{{\"eye\":{},\"center\":{},\"up\":{},\"fovy\":{},\"near\":{},\"far\":{}}},\"cameraFromParams\":{},\"params\":[{}]}}",
        js_str(e.key),
        js_str(group_of(e)),
        js_str(e.title),
        js_str(e.source),
        js_str(e.blurb),
        e.width,
        e.height,
        e.step,
        e.cost,
        vec3(c.eye),
        vec3(c.center),
        vec3(c.up),
        c.fovy,
        c.near,
        c.far,
        e.camera_for.is_some(),
        params.join(",")
    )
}

/// Every example: key, title, ln source file, blurb, size, step, camera
/// and parameter specs, as one JSON array.
#[wasm_bindgen]
pub fn catalog() -> String {
    let items: Vec<String> = all().map(example_json).collect();
    format!("[{}]", items.join(","))
}

/// The Rust code extract of one example (the "// <scene>" block).
#[wasm_bindgen]
pub fn code(key: &str) -> String {
    find(key).map(|e| code_extract(e.code)).unwrap_or_default()
}

/// The camera of an example for these parameters, as a camera array.
#[wasm_bindgen]
pub fn camera_for(key: &str, params: &[f64]) -> Vec<f64> {
    match find(key) {
        Some(e) => {
            let c = e.camera_with(&Params::from_values(e.params, params));
            vec![c.eye.x, c.eye.y, c.eye.z, c.center.x, c.center.y, c.center.z, c.up.x, c.up.y, c.up.z, c.fovy]
        }
        None => Vec::new(),
    }
}

fn camera_of(e: &Example, p: &Params, cam: &[f64]) -> Camera {
    let mut c = e.camera_with(p);
    if cam.len() >= 10 && cam.iter().all(|x| x.is_finite()) {
        c.eye = v3(cam[0], cam[1], cam[2]);
        c.center = v3(cam[3], cam[4], cam[5]);
        c.up = v3(cam[6], cam[7], cam[8]);
        c.fovy = cam[9].max(1.0).min(170.0);
    }
    c
}

#[wasm_bindgen]
pub struct Job {
    scene: Scene,
    overlay: Vec<Path>,
    /// The overlay scale: tan(fovy/2) of the example over that of the job,
    /// so flat art keeps its size against the scene when the page widens
    /// the lens for a narrow image.
    overlay_k: f64,
    matrix: Matrix,
    eye: Vector,
    width: f64,
    height: f64,
    step: f64,
    shape: usize,
    pending: Vec<Path>,
    pending_i: usize,
    overlay_done: bool,
    paths_out: u32,
    segments_out: f64,
}

#[wasm_bindgen]
impl Job {
    /// `step_scale` multiplies the example chop step (above 1 is coarser:
    /// the quick preview while the camera moves).
    #[wasm_bindgen(constructor)]
    pub fn new(key: &str, params: &[f64], camera: &[f64], width: f64, height: f64, step_scale: f64) -> Result<Job, JsValue> {
        let e = find(key).ok_or_else(|| JsValue::from_str(&format!("no example {}", key)))?;
        let p = Params::from_values(e.params, params);
        let c = camera_of(e, &p, camera);
        let base = e.camera_with(&p).fovy;
        let overlay_k = (base.to_radians() / 2.0).tan() / (c.fovy.to_radians() / 2.0).tan();
        let Built { mut scene, overlay } = (e.build)(&p, &c);
        scene.compile();
        let matrix = Scene::camera_matrix(c.eye, c.center, c.up, width, height, c.fovy, c.near, c.far);
        Ok(Job {
            scene,
            overlay,
            overlay_k,
            matrix,
            eye: c.eye,
            width,
            height,
            step: e.step * step_scale.max(0.1),
            shape: 0,
            pending: Vec::new(),
            pending_i: 0,
            overlay_done: false,
            paths_out: 0,
            segments_out: 0.0,
        })
    }

    /// Not in ln: keep the hidden lines (a wireframe render).
    pub fn set_show_hidden(&mut self, on: bool) {
        self.scene.show_hidden.set(on);
    }

    pub fn shape_count(&self) -> u32 {
        self.scene.shapes.len() as u32
    }

    /// 0..1: the part of the shapes that is done.
    pub fn progress(&self) -> f64 {
        let n = self.scene.shapes.len().max(1) as f64;
        if self.done() {
            return 1.0;
        }
        let inner = if self.pending.is_empty() { 0.0 } else { self.pending_i as f64 / self.pending.len() as f64 };
        ((self.shape as f64 - 1.0).max(0.0) + inner) / n
    }

    pub fn done(&self) -> bool {
        self.overlay_done && self.shape >= self.scene.shapes.len() && self.pending_i >= self.pending.len()
    }

    pub fn rays(&self) -> f64 {
        self.scene.rays.get() as f64
    }

    pub fn paths_out(&self) -> u32 {
        self.paths_out
    }

    pub fn segments_out(&self) -> f64 {
        self.segments_out
    }

    /// Render until about `budget` rays are cast (at least one path).
    pub fn next(&mut self, budget: u32) -> Vec<f32> {
        let start = self.scene.rays.get();
        let mut out: Vec<Path> = Vec::new();
        loop {
            if self.pending_i < self.pending.len() {
                let path = std::mem::take(&mut self.pending[self.pending_i]);
                self.pending_i += 1;
                out.extend(self.scene.render_paths(std::slice::from_ref(&path), &self.matrix, self.eye, self.width, self.height, self.step));
            } else if self.shape < self.scene.shapes.len() {
                self.pending = self.scene.shapes[self.shape].paths();
                self.pending_i = 0;
                self.shape += 1;
            } else if !self.overlay_done {
                self.overlay_done = true;
                let aspect = self.width / self.height;
                let k = self.overlay_k;
                let screen = screen_matrix(self.width, self.height);
                for q in &self.overlay {
                    out.push(q.iter().map(|v| screen.mul_position(v3(v.x * k / aspect, v.y * k, 0.0))).collect());
                }
            } else {
                break;
            }
            if self.scene.rays.get() - start >= budget as u64 {
                break;
            }
        }
        self.paths_out += out.len() as u32;
        self.segments_out += out.segment_count() as f64;
        encode(&out)
    }
}

fn encode(paths: &[Path]) -> Vec<f32> {
    let n: usize = paths.iter().map(|p| 1 + p.len() * 2).sum();
    let mut buf = Vec::with_capacity(n + 1);
    buf.push(paths.len() as f32);
    for p in paths {
        buf.push(p.len() as f32);
        for v in p {
            buf.push(v.x as f32);
            buf.push(v.y as f32);
        }
    }
    buf
}

/// A whole render as one SVG document: ln Paths.ToSVG with a paper fill,
/// an ink color and a line width (path.rs to_svg_styled).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn render_svg(key: &str, params: &[f64], camera: &[f64], width: f64, height: f64, step_scale: f64, stroke: &str, background: &str, line_width: f64) -> Result<String, JsValue> {
    let mut job = Job::new(key, params, camera, width, height, step_scale)?;
    let mut all: Vec<Path> = Vec::new();
    while !job.done() {
        let buf = job.next(u32::MAX);
        let mut i = 1;
        for _ in 0..buf[0] as usize {
            let n = buf[i] as usize;
            i += 1;
            let mut p = Vec::with_capacity(n);
            for _ in 0..n {
                p.push(v3(buf[i] as f64, buf[i + 1] as f64, 0.0));
                i += 2;
            }
            all.push(p);
        }
    }
    let title = find(key).map(|e| e.title).unwrap_or("");
    let style = SvgStyle { stroke: stroke.into(), background: background.into(), line_width, title: format!("{} (ln line art)", title) };
    Ok(all.to_svg_styled(width, height, &style))
}

#[wasm_bindgen]
pub fn version() -> String {
    format!("line-art {} (a Rust port of github.com/fogleman/ln)", env!("CARGO_PKG_VERSION"))
}
