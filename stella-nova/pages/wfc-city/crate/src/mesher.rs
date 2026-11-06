//! The chunk mesher.
//!
//! For each collapsed slot of a chunk, the mesher copies the static
//! geometry of its module (made once in `Rules::new`), moves it to the
//! cell and sets the birth. Then it adds the parts that depend on the
//! neighbours:
//!   - block facades on each F side: windows, shop fronts and doors,
//!     string courses, a cornice under a roof, corner pilasters, pipes.
//!     A door goes where a walkway or a balcony meets the wall. A plain
//!     wall goes behind a stair.
//!   - floor slabs: road setts, or paving next to a block; plaza tiles;
//!     raised grass with a stone curb; flat roof paving.
//!   - parapets on roof floors where the next cell is open (a drop).
//!
//! The facade style (wall colour, trim, window type) comes from a hash of
//! the 3 x 3 cell block of the column, so a row of blocks reads as a row
//! of separate houses.
//!
//! Output: a triangle list, 8 floats per vertex (see geom.rs).

use crate::geom::{B, STRIDE};
use crate::modules::*;
use crate::rng::{hash3, hashf};
use crate::world::{World, CS};

const STYLES: [(u8, u8, u8); 7] = [
    (C_SAND, C_TRIM, 0),
    (C_PLASTER, C_SAND, 1),
    (C_BRICK, C_TRIM, 1),
    (C_SLATE, C_TRIM, 2),
    (C_PLASTER, C_TERRA, 0),
    (C_SAND, C_BRICK, 2),
    (C_BRICK, C_SAND, 0),
];

pub fn style(seed: u32, i: i32, k: i32) -> (u8, u8, u8) {
    let h = hash3(seed ^ 0xA5A5, i.div_euclid(3), 7, k.div_euclid(3));
    STYLES[(h % STYLES.len() as u32) as usize]
}

/// The sides of a floor slot that need a parapet (j >= 1, open next cell).
pub fn parapets(w: &World, m: usize, i: i32, j: i32, k: i32) -> [bool; 4] {
    let mut out = [false; 4];
    if j < 1 || w.rules.kind[m].floor().is_none() {
        return out;
    }
    for d in 0..4 {
        if let Some(n) = w.module_at(i + DX[d], j, k + DZ[d]) {
            let kn = w.rules.kind[n];
            out[d] = if kn == Kind::Landing && w.rules.face[n][OPP[d]] == HD { false } else { kn.is_drop() };
        }
    }
    out
}

/// The end of an edge trim on side d, in the local z of the turned frame:
/// stop short of the corner when the next side has its own trim.
fn trim_end(flags: &[bool; 4], d: usize) -> f32 {
    if flags[(d + 1) % 4] {
        1.85
    } else {
        2.0
    }
}

pub fn chunk_mesh(w: &World, cx: i32, cz: i32) -> Vec<f32> {
    let Some(&c) = w.map.get(&(cx, cz)) else { return Vec::new() };
    let ch = &w.chunks[c as usize];
    let h = w.h;
    let mut v: Vec<f32> = Vec::with_capacity(48 * 1024);
    for lz in 0..8usize {
        for lx in 0..8usize {
            for j in 0..h {
                let l = (lz * 8 + lx) * h + j;
                let m = ch.module[l];
                if m == NONE {
                    continue;
                }
                let m = m as usize;
                let i = cx * CS + lx as i32;
                let k = cz * CS + lz as i32;
                let org = [2.0 * i as f32, 2.0 * j as f32, 2.0 * k as f32];
                let birth = ch.birth[l] as f32;
                let g = &w.rules.geom[m];
                v.reserve(g.len());
                for t in g.chunks_exact(STRIDE) {
                    v.extend_from_slice(&[t[0] + org[0], t[1] + org[1], t[2] + org[2], t[3], t[4], t[5], t[6], birth]);
                }
                context(w, &mut v, m, i, j as i32, k, org, birth);
            }
        }
    }
    v
}

#[allow(clippy::too_many_arguments)]
fn context(w: &World, v: &mut Vec<f32>, m: usize, i: i32, j: i32, k: i32, org: [f32; 3], birth: f32) {
    let kind = w.rules.kind[m];
    let face = w.rules.face[m];
    let nbk = |d: usize| w.module_at(i + DX[d], j + DY[d], k + DZ[d]).map(|n| w.rules.kind[n]);
    if kind == Kind::Mass {
        let above_mass = matches!(nbk(4), Some(Kind::Mass) | None);
        let st = style(w.seed, i, k);
        for d in 0..4 {
            if face[d] != F && face[d] != FT {
                continue;
            }
            if matches!(nbk(d), Some(Kind::Arcade | Kind::Gateway | Kind::RoadGate)) {
                continue;
            }
            let mut b = B { v, rot: d as u8, off: org, birth };
            facade(&mut b, w.seed, st, i, j, k, d, nbk(d), above_mass, matches!(face[(d + 3) % 4], F | FT));
        }
        return;
    }
    let Some((top, class)) = kind.floor() else { return };
    {
    let mut b = B { v: &mut *v, rot: 0, off: org, birth };
    match class {
        0 => {
            b.quad([0.0, top, 0.0], [0.0, top, 2.0], [2.0, top, 2.0], [2.0, top, 0.0], C_PAVE, [0.0, 1.0, 0.0]);
        }
        4 => {}
        1 => {
            for a in 0..2 {
                for c2 in 0..2 {
                    let (x0, z0) = (a as f32, c2 as f32);
                    let col = if (a + c2 + (i + k) as usize) % 2 == 0 { C_TRIM } else { C_SAND };
                    b.quad([x0, top, z0], [x0, top, z0 + 1.0], [x0 + 1.0, top, z0 + 1.0], [x0 + 1.0, top, z0], col, [0.0, 1.0, 0.0]);
                }
            }
        }
        2 => {
            b.quad([0.0, top, 0.0], [0.0, top, 2.0], [2.0, top, 2.0], [2.0, top, 0.0], C_GRASS, [0.0, 1.0, 0.0]);
        }
        _ => {
            b.quad([0.0, top, 0.0], [0.0, top, 2.0], [2.0, top, 2.0], [2.0, top, 0.0], C_PAVE, [0.0, 1.0, 0.0]);
        }
    }
    }
    // curbs round grass
    if class == 2 {
        let mut curb = [false; 4];
        for d in 0..4 {
            curb[d] = match nbk(d) {
                Some(n) => n.floor().map_or(true, |f| f.1 != 2),
                None => false,
            };
        }
        for d in 0..4 {
            if curb[d] {
                let ze = trim_end(&curb, d);
                let mut b = B { v: &mut *v, rot: d as u8, off: org, birth };
                b.cuboid([1.84, 0.0, 0.0], [2.0, top + 0.08, ze], C_SAND, 1 | 4 | 16);
            }
        }
    }
    // parapets on roofs over a drop
    let par = parapets(w, m, i, j, k);
    if par.iter().any(|&x| x) {
        let (wall, trim, _) = style(w.seed, i, k);
        for d in 0..4 {
            if !par[d] {
                continue;
            }
            let ze = trim_end(&par, d);
            let mut b = B { v: &mut *v, rot: d as u8, off: org, birth };
            b.cuboid([1.85, 0.0, 0.0], [2.0, 0.8, ze], wall, 1 | 4);
            b.cuboid([1.8, 0.8, 0.0], [2.04, 0.9, ze], trim, 1 | 4 | 16 | 32 | if ze < 2.0 { 0 } else { 2 } | 8);
        }
    }
}

/// The wall of a block on its local +x side (the builder turns it to d).
#[allow(clippy::too_many_arguments)]
fn facade(b: &mut B, seed: u32, st: (u8, u8, u8), i: i32, j: i32, k: i32, d: usize, nb: Option<Kind>, above_mass: bool, left_f: bool) {
    let (wall, trim, win) = st;
    let lit = |n: i32| if hashf(seed ^ 0x77, i * 8 + d as i32 * 2 + n, j, k) < 0.13 { C_LAMP } else { C_GLASS };
    match nb {
        Some(n) if n.is_climb() => wall_px(b, 2.0, &[], &[], wall, 0.0, 0.0, 2.0),
        Some(n) if n.is_deck() => {
            wall_px(b, 2.0, &[[0.6, 1.4, 0.1, 1.85]], &[C_WOOD], wall, 0.12, 0.0, 2.0);
        }
        _ if j == 0 => {
            let hv = hashf(seed ^ 0x31, i, d as i32, k);
            if hv < 0.45 {
                wall_px(b, 2.0, &[[0.25, 0.85, 0.1, 1.7], [1.15, 1.75, 0.6, 1.6]], &[C_WOOD, lit(0)], wall, 0.12, 0.0, 2.0);
            } else {
                let glass = if hv > 0.8 { C_LAMP } else { C_GLASS };
                wall_px(b, 2.0, &[[0.2, 1.8, 0.45, 1.62]], &[glass], wall, 0.1, 0.0, 2.0);
                let aw = if hv > 0.62 { C_TERRA } else { C_COPPER };
                b.boxc([2.0, 1.72, 0.15], [2.42, 1.8, 1.85], aw);
                b.cuboid([1.99, 0.0, 0.0], [2.05, 0.45, 2.0], C_SLATE, 1 | 16);
            }
        }
        _ => {
            match win {
                0 => wall_px(b, 2.0, &[[0.62, 1.38, 0.45, 1.75]], &[lit(0)], wall, 0.12, 0.0, 2.0),
                1 => wall_px(b, 2.0, &[[0.25, 0.85, 0.6, 1.65], [1.15, 1.75, 0.6, 1.65]], &[lit(0), lit(1)], wall, 0.12, 0.0, 2.0),
                _ => wall_px(b, 2.0, &[[0.12, 1.88, 0.55, 1.55]], &[lit(0)], wall, 0.1, 0.0, 2.0),
            }
            b.cuboid([1.98, 0.0, 0.0], [2.05, 0.08, 2.0], trim, 1 | 16 | 32);
        }
    }
    if !above_mass {
        b.cuboid([1.9, 1.86, 0.0], [2.1, 2.0, 2.0], trim, 1 | 16 | 32);
    }
    if left_f {
        b.cuboid([1.86, 0.0, -0.06], [2.06, 2.0, 0.14], trim, 1 | 8);
    }
    if hashf(seed ^ 0x99, i * 4 + d as i32, 0, k) < 0.1 {
        b.cuboid([2.0, 0.0, 1.72], [2.09, 2.0, 1.81], C_IRON, 1 | 2 | 8);
    }
}
