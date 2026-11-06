//! The player body: an axis aligned box against the module boxes.
//!
//! State (8 floats, changed in place): [x, y, z, vx, vy, vz, grounded,
//! unused]. The feet are at y. The body is [x-r, x+r] x [y, y+height] x
//! [z-r, z+r]. Gravity is 18 m/s^2 unless `fly`.
//!
//! The move is cut into sub steps of at most 0.2 m, so a body at 30 m/s
//! with dt <= 1/30 cannot pass through a box. Each sub step moves x, then
//! z, then y. A blocked horizontal move on the ground tries a step-up of
//! at most 0.55 m (stairs). After the move, a body that was on the ground
//! and does not jump snaps down by at most 0.55 m (down a stair).
//!
//! The earth is solid below y = 0 (below y = -0.45 in a canal cell, so a
//! walker can wade and step out). Cells
//! that are not collapsed have no boxes.

use crate::mesher::parapets;
use crate::modules::Kind;
use crate::world::World;

pub const STEP_UP: f32 = 0.55;
const EPS: f32 = 1e-4;

pub fn collect(w: &World, lo: [f32; 3], hi: [f32; 3], out: &mut Vec<[f32; 6]>) {
    out.clear();
    let i0 = (lo[0] / 2.0).floor() as i32;
    let i1 = (hi[0] / 2.0).floor() as i32;
    let k0 = (lo[2] / 2.0).floor() as i32;
    let k1 = (hi[2] / 2.0).floor() as i32;
    let j0 = ((lo[1] / 2.0).floor() as i32 - 1).max(0);
    let j1 = ((hi[1] / 2.0).floor() as i32 + 1).min(w.h as i32 - 1);
    for k in k0..=k1 {
        for i in i0..=i1 {
            let (ox, oz) = (2.0 * i as f32, 2.0 * k as f32);
            if lo[1] < 0.2 {
                let canal = w.module_at(i, 0, k).map_or(false, |m| w.rules.kind[m].is_canal());
                let top = if canal { -0.45 } else { 0.0 };
                out.push([ox, -100.0, oz, ox + 2.0, top, oz + 2.0]);
            }
            for j in j0..=j1 {
                let Some(m) = w.module_at(i, j, k) else { continue };
                let oy = 2.0 * j as f32;
                for b in &w.rules.boxes[m] {
                    out.push([b[0] + ox, b[1] + oy, b[2] + oz, b[3] + ox, b[4] + oy, b[5] + oz]);
                }
                if j >= 1 && w.rules.kind[m].floor().is_some() {
                    let par = parapets(w, m, i, j, k);
                    for d in 0..4 {
                        if par[d] {
                            let b = crate::geom::rot_box([1.85, 0.0, 0.0, 2.0, 0.9, 2.0], d as u8);
                            out.push([b[0] + ox, b[1] + oy, b[2] + oz, b[3] + ox, b[4] + oy, b[5] + oz]);
                        }
                    }
                }
            }
        }
    }
}

#[inline]
fn overlaps(b: &[f32; 6], p: [f32; 3], r: f32, h: f32) -> bool {
    b[0] < p[0] + r - EPS && b[3] > p[0] - r + EPS && b[1] < p[1] + h - EPS && b[4] > p[1] + EPS && b[2] < p[2] + r - EPS && b[5] > p[2] - r + EPS
}

fn hits<'a>(boxes: &'a [[f32; 6]], p: [f32; 3], r: f32, h: f32) -> impl Iterator<Item = &'a [f32; 6]> + 'a {
    boxes.iter().filter(move |b| overlaps(b, p, r, h))
}

pub fn move_body(w: &World, s: &mut [f32], dt: f32, r: f32, h: f32, fly: bool) {
    if s.len() < 7 {
        return;
    }
    let dt = if dt.is_finite() { dt.clamp(0.0, 0.1) } else { 0.0 };
    let r = r.clamp(0.05, 0.9);
    let h = h.clamp(0.2, 1.95);
    let mut p = [s[0], s[1], s[2]];
    let mut v = [s[3], s[4], s[5]];
    let was_ground = s[6] > 0.5;
    if !fly {
        v[1] = (v[1] - 18.0 * dt).max(-55.0);
    }
    let d = [v[0] * dt, v[1] * dt, v[2] * dt];
    let dmax = d[0].abs().max(d[1].abs()).max(d[2].abs());
    let n = ((dmax / 0.2).ceil() as usize).clamp(1, 64);
    // one box list for the whole swept volume
    let lo = [p[0].min(p[0] + d[0]) - r - 0.1, p[1].min(p[1] + d[1]) - STEP_UP - 0.1, p[2].min(p[2] + d[2]) - r - 0.1];
    let hi = [p[0].max(p[0] + d[0]) + r + 0.1, p[1].max(p[1] + d[1]) + h + STEP_UP + 0.1, p[2].max(p[2] + d[2]) + r + 0.1];
    let mut boxes = Vec::with_capacity(64);
    collect(w, lo, hi, &mut boxes);
    let mut grounded = false;
    let can_step = !fly && was_ground;
    for _ in 0..n {
        for a in [0usize, 2] {
            let delta = d[a] / n as f32;
            if delta == 0.0 {
                continue;
            }
            let mut q = p;
            q[a] += delta;
            if hits(&boxes, q, r, h).next().is_none() {
                p = q;
                continue;
            }
            if can_step || grounded {
                let top = hits(&boxes, q, r, h).map(|b| b[4]).fold(f32::MIN, f32::max);
                if top > p[1] && top - p[1] <= STEP_UP + 1e-3 {
                    let mut u = q;
                    u[1] = top + 1e-3;
                    if hits(&boxes, u, r, h).next().is_none() {
                        p = u;
                        continue;
                    }
                }
            }
            // move to contact
            let mut lim = q[a];
            for b in hits(&boxes, q, r, h) {
                if delta > 0.0 {
                    lim = lim.min(b[a] - r - EPS * 2.0);
                } else {
                    lim = lim.max(b[a + 3] + r + EPS * 2.0);
                }
            }
            let mut c = p;
            c[a] = if delta > 0.0 { lim.max(p[a]) } else { lim.min(p[a]) };
            if hits(&boxes, c, r, h).next().is_none() {
                p = c;
            }
            v[a] = 0.0;
        }
        let dy = d[1] / n as f32;
        if dy != 0.0 {
            let mut q = p;
            q[1] += dy;
            if hits(&boxes, q, r, h).next().is_none() {
                p = q;
            } else if dy < 0.0 {
                let top = hits(&boxes, q, r, h).map(|b| b[4]).fold(f32::MIN, f32::max);
                let mut c = p;
                c[1] = top.min(p[1]).max(q[1]);
                if hits(&boxes, c, r, h).next().is_none() {
                    p = c;
                }
                grounded = true;
                v[1] = 0.0;
            } else {
                let bot = hits(&boxes, q, r, h).map(|b| b[1]).fold(f32::MAX, f32::min);
                let mut c = p;
                c[1] = (bot - h - EPS).max(p[1]);
                if hits(&boxes, c, r, h).next().is_none() {
                    p = c;
                }
                v[1] = 0.0;
            }
        }
    }
    // snap down a stair
    if !fly && was_ground && !grounded && v[1] <= 0.0 {
        let mut best = f32::MIN;
        for b in boxes.iter() {
            if b[0] < p[0] + r && b[3] > p[0] - r && b[2] < p[2] + r && b[5] > p[2] - r && b[4] <= p[1] + 1e-3 && b[4] >= p[1] - STEP_UP {
                best = best.max(b[4]);
            }
        }
        if best > f32::MIN {
            let mut c = p;
            c[1] = best + 1e-4;
            if hits(&boxes, c, r, h).next().is_none() {
                p = c;
                grounded = true;
                v[1] = 0.0;
            }
        }
    }
    // a resting body: probe just below the feet
    if !grounded && v[1] <= 0.0 {
        let q = [p[0], p[1] - 0.02, p[2]];
        if hits(&boxes, q, r, h).next().is_some() {
            grounded = true;
        }
    }
    s[0] = p[0];
    s[1] = p[1];
    s[2] = p[2];
    s[3] = v[0];
    s[4] = v[1];
    s[5] = v[2];
    s[6] = if grounded { 1.0 } else { 0.0 };
}

/// The top of the highest box under (x, z), or 0 on bare earth.
pub fn ground_height(w: &World, x: f32, z: f32) -> f32 {
    let mut boxes = Vec::new();
    collect(w, [x - 0.01, -1.0, z - 0.01], [x + 0.01, 2.0 * w.h as f32 + 4.0, z + 0.01], &mut boxes);
    let mut top = 0.0f32;
    for b in &boxes {
        if b[0] <= x && b[3] >= x && b[2] <= z && b[5] >= z {
            top = top.max(b[4]);
        }
    }
    let _ = Kind::Air;
    top
}
