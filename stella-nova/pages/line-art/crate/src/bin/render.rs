//! Native command line render of one example to an SVG file (not in ln;
//! the ln examples write PNG files with the gg library).
//!
//!   cargo run --release --bin render -- <key> <out.svg> [width] [height] [step-scale] [k=v ...]
//!
//! With the key "list" it prints the example keys. The size defaults to
//! the size of the Go example. A k=v argument sets one parameter.

use line_art::examples::{find, Params, EXAMPLES};
use line_art::path::{PathsExt, SvgStyle};
use line_art::scene::{screen_matrix, Scene};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 || args[1] == "list" {
        for e in EXAMPLES {
            println!("{:<12} {:<22} {}", e.key, e.title, e.source);
        }
        return;
    }
    let ex = find(&args[1]).unwrap_or_else(|| panic!("no example {}", args[1]));
    let out = args.get(2).cloned().unwrap_or_else(|| format!("{}.svg", ex.key));
    let w: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(ex.width);
    let h: f64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(ex.height);
    let k: f64 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let mut p = Params::defaults(ex.params);
    for a in args.iter().skip(6) {
        if let Some((key, val)) = a.split_once('=') {
            if let Some(i) = ex.params.iter().position(|s| s.key == key) {
                p.values[i] = val.parse().unwrap_or(p.values[i]);
            }
        }
    }
    let c = ex.camera_with(&p);
    let t0 = Instant::now();
    let mut built = (ex.build)(&p, &c);
    let t1 = Instant::now();
    let mut paths = built.scene.render(c.eye, c.center, c.up, w, h, c.fovy, c.near, c.far, ex.step * k);
    let aspect = w / h;
    let screen = screen_matrix(w, h);
    for q in &built.overlay {
        let flat: Vec<_> = q.iter().map(|v| line_art::vector::v3(v.x / aspect, v.y, 0.0)).collect();
        paths.push(flat.iter().map(|v| screen.mul_position(*v)).collect());
    }
    let t2 = Instant::now();
    let style = SvgStyle { stroke: "#111".into(), background: "#fff".into(), line_width: (w.max(h) / 700.0).max(1.0), title: ex.title.into() };
    std::fs::write(&out, paths.to_svg_styled(w, h, &style)).expect("write");
    eprintln!(
        "{} shapes {} paths {} segments {} rays {} build {:.0} ms render {:.0} ms",
        ex.key,
        built.scene.shapes.len(),
        paths.len(),
        paths.segment_count(),
        built.scene.rays.get(),
        (t1 - t0).as_secs_f64() * 1e3,
        (t2 - t1).as_secs_f64() * 1e3
    );
    let _ = Scene::new();
}
