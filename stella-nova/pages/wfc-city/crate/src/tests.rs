//! Native tests. Run `cargo test --release -- --nocapture` to see the
//! city quality report and the native timings.

use crate::body::{ground_height, move_body};
use crate::mesher::chunk_mesh;
use crate::modules::*;
use crate::world::World;
use std::collections::VecDeque;
use std::time::Instant;

const AREA: i32 = 64;

/// Generate the cells 0..AREA in x and z (focus at the centre).
fn gen_area(seed: u32) -> World {
    let mut w = World::new(seed, 12);
    let c = AREA as f32; // metres: cell 32
    loop {
        if w.update(c, c, 46, 5000) == 0 {
            break;
        }
    }
    w
}

#[test]
fn rotation_expansion() {
    let r = Rules::new(12);
    let total: usize = r.protos.iter().map(|p| p.rots as usize).sum();
    assert_eq!(total, r.n());
    for (m, md) in r.mods.iter().enumerate() {
        let p = &r.protos[md.proto as usize];
        for s in 0..4 {
            assert_eq!(r.face[m][(s + md.rot as usize) % 4], p.sides[s], "{} rot {}", p.name, md.rot);
        }
        if p.top == VT {
            assert_eq!(r.face[m][4], VT + md.rot);
        }
    }
    // the turned geometry of a stair top rises toward its WL side
    for (m, md) in r.mods.iter().enumerate() {
        if r.kind[m] != Kind::StairTop {
            continue;
        }
        let g = &r.geom[m];
        let (mut sx, mut sz, mut n) = (0.0f32, 0.0f32, 0.0f32);
        for v in g.chunks_exact(8) {
            if v[1] > 2.0 && v[6] == C_PAVE as f32 {
                sx += v[0];
                sz += v[2];
                n += 1.0;
            }
        }
        let (cx, cz) = (sx / n - 1.0, sz / n - 1.0);
        let d = (0 + md.rot as usize) % 4;
        let ok = match d {
            0 => cx > 0.3,
            1 => cz > 0.3,
            2 => cx < -0.3,
            _ => cz < -0.3,
        };
        assert!(ok, "stair_top rot {} high end at ({}, {})", md.rot, cx, cz);
    }
    // the face masks are symmetric
    for a in 0..r.n() {
        for b in 0..r.n() {
            for d in 0..6 {
                assert_eq!(dom_has(&r.single_sup[a][d], b), dom_has(&r.single_sup[b][OPP[d]], a));
            }
        }
    }
    println!("prototypes {} modules {}", r.protos.len(), r.n());
}

fn check_area(w: &World) -> usize {
    let mut pairs = 0;
    for k in 0..AREA {
        for i in 0..AREA {
            for j in 0..w.h as i32 {
                let a = w.module_at(i, j, k).unwrap_or_else(|| panic!("open slot at {} {} {}", i, j, k));
                for d in 0..6 {
                    let (ni, nj, nk) = (i + DX[d], j + DY[d], k + DZ[d]);
                    if nj < 0 {
                        assert!(v_compat(VE, w.rules.face[a][5]), "layer 0 needs earth");
                        continue;
                    }
                    if nj >= w.h as i32 {
                        assert!(matches!(w.rules.face[a][4], VA | VA2), "top layer needs sky");
                        continue;
                    }
                    if let Some(b) = w.module_at(ni, nj, nk) {
                        assert!(w.check_pair(a, b, d), "bad pair {} -> {} dir {} at {} {} {}", w.rules.proto_of(a).name, w.rules.proto_of(b).name, d, i, j, k);
                        pairs += 1;
                    }
                }
            }
        }
    }
    pairs
}

#[test]
fn sweep_compatible_5_seeds() {
    for seed in [1u32, 2, 3, 77, 4242] {
        let t = Instant::now();
        let w = gen_area(seed);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        let pairs = check_area(&w);
        println!(
            "seed {:5}: {} pairs ok, collapses {}, backtracks {}, contradictions {}, repairs {}, full resets {}, {:.0} ms",
            seed, pairs, w.counter - 1, w.backtracks, w.contradictions, w.repairs, w.full_resets, ms
        );
        assert_eq!(w.full_resets, 0);
        assert!(w.backtracks < (w.counter as u64) / 4, "too many backtracks");
    }
}

fn walk_script(w: &mut World) {
    for s in 0..80 {
        let t = s as f32 * 0.15;
        let (x, z) = (t.cos() * 30.0 + s as f32 * 2.0, t.sin() * 30.0);
        w.update(x, z, 20, 300);
        if s % 20 == 19 {
            w.forget_far(x, z, 40);
        }
    }
}

#[test]
fn determinism() {
    let mut a = World::new(9, 12);
    let mut b = World::new(9, 12);
    walk_script(&mut a);
    walk_script(&mut b);
    assert_eq!(a.counter, b.counter);
    assert_eq!(a.backtracks, b.backtracks);
    let mut n = 0;
    for k in -60..60 {
        for i in -40..220 {
            for j in 0..12 {
                assert_eq!(a.slot_info(i, j, k), b.slot_info(i, j, k));
                n += 1;
            }
        }
    }
    assert_eq!(a.take_dirty(), b.take_dirty());
    let mut c = World::new(10, 12);
    walk_script(&mut c);
    // compare only slots that both walks keep collapsed (forget_far drops
    // the start of the walk)
    let (mut both, mut diff) = (0, 0);
    for k in -20..20 {
        for i in -20..60 {
            for j in 0..12 {
                let (x, y) = (a.slot_info(i, j, k), c.slot_info(i, j, k));
                if x[0] == 2 && y[0] == 2 {
                    both += 1;
                    diff += (x != y) as usize;
                }
            }
        }
    }
    assert!(both > 1000 && diff * 10 > both, "another seed must give another city: {} of {}", diff, both);
    println!("determinism: {} slots equal", n);
}

#[test]
fn chunk_mesh_layout() {
    let mut w = World::new(5, 12);
    while w.update(8.0, 8.0, 24, 5000) > 0 {}
    let mut max_v = 0;
    let mut total = 0;
    let t = Instant::now();
    let mut meshes = 0;
    for cz in -2..2 {
        for cx in -2..2 {
            let v = chunk_mesh(&w, cx, cz);
            meshes += 1;
            assert_eq!(v.len() % (8 * 3), 0);
            let nv = v.len() / 8;
            max_v = max_v.max(nv);
            total += nv;
            assert!(nv < 96_000, "chunk {} {} has {} vertices", cx, cz, nv);
            for p in v.chunks_exact(8) {
                let nl = (p[3] * p[3] + p[4] * p[4] + p[5] * p[5]).sqrt();
                assert!((nl - 1.0).abs() < 1e-3);
                assert!(p[6] >= 0.0 && p[6] <= 15.0 && p[6].fract() == 0.0);
                assert!(p[7] >= 1.0 && p[7] < w.counter as f32);
                let (x0, z0) = (cx as f32 * 16.0, cz as f32 * 16.0);
                assert!(p[0] > x0 - 1.0 && p[0] < x0 + 17.0 && p[2] > z0 - 1.0 && p[2] < z0 + 17.0);
                assert!(p[1] > -1.0 && p[1] < 26.0);
            }
        }
    }
    let ms = t.elapsed().as_secs_f64() * 1000.0 / meshes as f64;
    println!("chunk_mesh: max {} vertices, mean {}, native {:.3} ms per chunk", max_v, total / meshes, ms);
    assert!(chunk_mesh(&w, 100, 100).is_empty());
}

fn find(w: &World, kinds: &[Kind], j: i32, r: i32) -> Option<(i32, i32, i32, usize)> {
    for k in -r..r {
        for i in -r..r {
            if let Some(m) = w.module_at(i, j, k) {
                if kinds.contains(&w.rules.kind[m]) {
                    return Some((i, j, k, m));
                }
            }
        }
    }
    None
}

#[test]
fn body_fall_tunnel_stairs() {
    let mut w = World::new(3, 12);
    while w.update(0.0, 0.0, 24, 5000) > 0 {}
    // fall to the street
    let (i, _, k, _) = find(&w, &[Kind::Street, Kind::Plaza], 0, 20).expect("a pavement");
    let (x, z) = (2.0 * i as f32 + 1.0, 2.0 * k as f32 + 1.0);
    let mut s = [x, 30.0, z, 0.0, 0.0, 0.0, 0.0, 0.0];
    for _ in 0..240 {
        move_body(&w, &mut s, 1.0 / 60.0, 0.3, 1.7, false);
    }
    assert!(s[6] > 0.5 && (s[1] - 0.1).abs() < 0.02, "rest on the street: y {}", s[1]);
    // no tunnelling: 30 m/s down at dt 1/30 onto a roof
    let (i, j, k, _) = find(&w, &[Kind::Roof], 3, 20).or_else(|| find(&w, &[Kind::Roof], 2, 20)).expect("a roof");
    let top = 2.0 * j as f32 + 0.1;
    let (x, z) = (2.0 * i as f32 + 1.0, 2.0 * k as f32 + 1.0);
    let mut s = [x, top + 10.0, z, 0.0, -30.0, 0.0, 0.0, 0.0];
    let mut lowest = f32::MAX;
    for _ in 0..30 {
        s[4] = s[4].min(-30.0 + 0.0);
        move_body(&w, &mut s, 1.0 / 30.0, 0.3, 1.7, false);
        lowest = lowest.min(s[1]);
        if s[6] > 0.5 {
            break;
        }
    }
    assert!(lowest >= top - 0.01, "tunnelled: {} < {}", lowest, top);
    // horizontal: 30 m/s into a block wall
    let (i, j, k, m) = find(&w, &[Kind::Mass], 0, 20).expect("a block");
    let face = w.rules.face[m];
    if let Some(d) = (0..4).find(|&d| face[d] == F || face[d] == FT) {
        let (ox, oz) = (2.0 * i as f32 + 1.0 + DX[d] as f32 * 4.0, 2.0 * k as f32 + 1.0 + DZ[d] as f32 * 4.0);
        let gy = 2.0 * j as f32 + 0.6;
        let mut s = [ox, gy, oz, -DX[d] as f32 * 30.0, 0.0, -DZ[d] as f32 * 30.0, 0.0, 0.0];
        for _ in 0..10 {
            s[3] = -DX[d] as f32 * 30.0;
            s[5] = -DZ[d] as f32 * 30.0;
            move_body(&w, &mut s, 1.0 / 30.0, 0.3, 1.7, true);
        }
        let inside = s[0] > 2.0 * i as f32 && s[0] < 2.0 * i as f32 + 2.0 && s[2] > 2.0 * k as f32 && s[2] < 2.0 * k as f32 + 2.0;
        assert!(!inside, "tunnelled into a block");
    }
    // walk up a stair: from the low end of a stair foot to the roof
    let mut climbed = 0;
    let mut tried = 0;
    for k in -24..24 {
        for i in -24..24 {
            for j in 0..10 {
                let Some(m) = w.module_at(i, j, k) else { continue };
                if w.rules.kind[m] != Kind::StairSteep && w.rules.kind[m] != Kind::StairFoot {
                    continue;
                }
                let rot = w.rules.mods[m].rot as usize;
                let _ = rot;
                // the high direction: toward the centre of the highest box
                let hb = w.rules.boxes[m].iter().filter(|b| (b[3] - b[0]).min(b[5] - b[2]) > 0.3).fold([0.0f32; 6], |a, b| if b[4] > a[4] { *b } else { a });
                let (bx, bz) = ((hb[0] + hb[3]) * 0.5 - 1.0, (hb[2] + hb[5]) * 0.5 - 1.0);
                let hd = (0..4).max_by(|&a, &b| {
                    let sa = DX[a] as f32 * bx + DZ[a] as f32 * bz;
                    let sb = DX[b] as f32 * bx + DZ[b] as f32 * bz;
                    sa.partial_cmp(&sb).unwrap()
                }).unwrap();
                let ld = (0..4).find(|&d| DX[d] == -DX[hd] && DZ[d] == -DZ[hd]).unwrap();
                let (cx, cz) = (2.0 * i as f32 + 1.0, 2.0 * k as f32 + 1.0);
                let base = 2.0 * j as f32 + 0.1;
                let mut s = [cx + DX[ld] as f32 * 1.3, base + 0.01, cz + DZ[ld] as f32 * 1.3, 0.0, 0.0, 0.0, 1.0, 0.0];
                // the start must be free floor
                let mut probe = s;
                move_body(&w, &mut probe, 1.0 / 60.0, 0.25, 1.7, false);
                if (probe[1] - base).abs() > 0.05 {
                    continue;
                }
                tried += 1;
                let mut top_y = s[1];
                for _ in 0..200 {
                    s[3] = DX[hd] as f32 * 3.0;
                    s[5] = DZ[hd] as f32 * 3.0;
                    move_body(&w, &mut s, 1.0 / 60.0, 0.25, 1.7, false);
                    top_y = top_y.max(s[1]);
                }
                if top_y > base + 1.9 {
                    climbed += 1;
                } else if std::env::var("STAIR_DIAG").is_ok() {
                    let up = w.module_at(i, j + 1, k).map(|u| w.rules.protos[w.rules.mods[u].proto as usize].name).unwrap_or("-");
                    let fw = w.module_at(i + DX[hd], j, k + DZ[hd]).map(|u| w.rules.protos[w.rules.mods[u].proto as usize].name).unwrap_or("-");
                    let fwu = w.module_at(i + DX[hd], j + 1, k + DZ[hd]).map(|u| w.rules.protos[w.rules.mods[u].proto as usize].name).unwrap_or("-");
                    println!("fail hd {} hb {:?} {:?} y {:.2} over base {:.2} dx {:.2} dz {:.2} up {} fwd {} fwd_up {}", hd, hb, w.rules.kind[m], s[1], s[1] - base, s[0] - cx, s[2] - cz, up, fw, fwu);
                }
            }
        }
    }
    println!("stairs: {} of {} climbed to the next level", climbed, tried);
    assert!(tried > 0 && climbed * 10 >= tried * 7, "step-up on stairs: {} of {}", climbed, tried);
    let gh = ground_height(&w, x, z);
    assert!(gh >= top - 0.01);
    // timing
    let t = Instant::now();
    let mut s = [x, top + 0.01, z, 4.0, 0.0, 3.0, 1.0, 0.0];
    for _ in 0..10000 {
        move_body(&w, &mut s, 1.0 / 60.0, 0.3, 1.7, false);
    }
    println!("move_body native {:.4} ms", t.elapsed().as_secs_f64() * 1000.0 / 10000.0);
}

#[test]
fn update_timing_native() {
    let mut w = World::new(11, 12);
    w.update(0.0, 0.0, 24, 1);
    let mut times = Vec::new();
    for s in 0..60 {
        let t = Instant::now();
        let n = w.update(s as f32 * 0.5, 0.0, 24, 300);
        if n == 300 {
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = times[times.len() / 2];
    println!("update(budget 300) native: median {:.2} ms, max {:.2} ms over {} calls", med, times[times.len() - 1], times.len());
}

// ── city quality ────────────────────────────────────────────────────────

fn standable(k: Kind) -> bool {
    use Kind::*;
    k.floor().is_some() || k.is_climb() || matches!(k, Canal | RoadGate | Gateway | Arcade | Walkway | WalkwayLamp | CanalBridge | Balcony)
}

fn passable(a: u8, b: u8) -> bool {
    let walk = |c: u8| matches!(c, R | D | L | AR | S);
    (walk(a) && walk(b) && h_compat(a, b)) || (a == KP && b == KM) || (a == KM && b == KP) || (a == RP && b == RM) || (a == RM && b == RP)
}

pub struct Quality {
    pub air: f64,
    pub mass_by_layer: Vec<f64>,
    pub heights: Vec<usize>,
    pub buildings: usize,
    pub footprint: f64,
    pub roofs: usize,
    pub roofs_reached: usize,
    pub levels_reached: Vec<usize>,
    pub climbs_per_100: f64,
    pub used: usize,
    pub spread: f64,
    pub usage: Vec<(String, usize)>,
    pub ground_open: f64,
}

fn quality(w: &World) -> Quality {
    let h = w.h as i32;
    let n = AREA;
    let at = |i: i32, j: i32, k: i32| -> Option<usize> {
        if i < 0 || k < 0 || i >= n || k >= n || j < 0 || j >= h {
            None
        } else {
            w.module_at(i, j, k)
        }
    };
    let mut air = 0usize;
    let mut total = 0usize;
    let mut mass_l = vec![0usize; h as usize];
    let mut use_p = vec![0usize; w.rules.protos.len()];
    let mut use_m = vec![0usize; w.rules.n()];
    let mut heights = vec![0usize; h as usize + 1];
    let mut climbs = 0;
    let mut ground_open = 0;
    for k in 0..n {
        for i in 0..n {
            let mut top = 0;
            for j in 0..h {
                let m = at(i, j, k).unwrap();
                total += 1;
                use_m[m] += 1;
                use_p[w.rules.mods[m].proto as usize] += 1;
                let kd = w.rules.kind[m];
                if kd == Kind::Air {
                    air += 1;
                }
                if kd == Kind::Mass {
                    mass_l[j as usize] += 1;
                    top = j as usize + 1;
                }
                if matches!(kd, Kind::StairFoot | Kind::StairSteep | Kind::RampFoot | Kind::TowerBase) {
                    climbs += 1;
                }
                if j == 0 && kd != Kind::Mass {
                    ground_open += 1;
                }
            }
            heights[top] += 1;
        }
    }
    // buildings: connected block cells at layer 0
    let mut seen = vec![false; (n * n) as usize];
    let mut sizes = Vec::new();
    for k in 0..n {
        for i in 0..n {
            let id = (k * n + i) as usize;
            if seen[id] || at(i, 0, k).map(|m| w.rules.kind[m]) != Some(Kind::Mass) {
                continue;
            }
            let mut q = VecDeque::from([(i, k)]);
            seen[id] = true;
            let mut sz = 0;
            while let Some((a, b)) = q.pop_front() {
                sz += 1;
                for d in 0..4 {
                    let (x, z) = (a + DX[d], b + DZ[d]);
                    if x < 0 || z < 0 || x >= n || z >= n {
                        continue;
                    }
                    let id2 = (z * n + x) as usize;
                    if !seen[id2] && at(x, 0, z).map(|m| w.rules.kind[m]) == Some(Kind::Mass) {
                        seen[id2] = true;
                        q.push_back((x, z));
                    }
                }
            }
            sizes.push(sz);
        }
    }
    // walk graph: flood from all layer 0 standable cells
    let idx = |i: i32, j: i32, k: i32| ((j * n + k) * n + i) as usize;
    let mut reach = vec![false; (n * n * h) as usize];
    let mut q = VecDeque::new();
    // start from every layer 0 standable cell of the largest ground component
    let mut comp = vec![usize::MAX; (n * n) as usize];
    let mut comps: Vec<Vec<(i32, i32)>> = Vec::new();
    for k in 0..n {
        for i in 0..n {
            let id = (k * n + i) as usize;
            let ok = |a: i32, b: i32| at(a, 0, b).map_or(false, |m| standable(w.rules.kind[m]));
            if comp[id] != usize::MAX || !ok(i, k) {
                continue;
            }
            let cid = comps.len();
            let mut cells = vec![(i, k)];
            comp[id] = cid;
            let mut t = 0;
            while t < cells.len() {
                let (a, b) = cells[t];
                t += 1;
                let m = at(a, 0, b).unwrap();
                for d in 0..4 {
                    let (x, z) = (a + DX[d], b + DZ[d]);
                    if x < 0 || z < 0 || x >= n || z >= n || !ok(x, z) {
                        continue;
                    }
                    let id2 = (z * n + x) as usize;
                    let m2 = at(x, 0, z).unwrap();
                    if comp[id2] == usize::MAX && passable(w.rules.face[m][d], w.rules.face[m2][OPP[d]]) {
                        comp[id2] = cid;
                        cells.push((x, z));
                    }
                }
            }
            comps.push(cells);
        }
    }
    comps.sort_by(|a, b| b.len().cmp(&a.len()));
    let start = comps.first().map(|c| c.len());
    let all_ground = std::env::var("WFC_ALL_GROUND").is_ok();
    for c in comps.iter().take(if all_ground { usize::MAX } else { 1 }) {
        for &(i, k) in c {
            reach[idx(i, 0, k)] = true;
            q.push_back((i, 0, k));
        }
    }
    println!("ground components {}, largest {:?}, next {:?}", comps.len(), start, comps.get(1).map(|c| c.len()));
    while let Some((i, j, k)) = q.pop_front() {
        let m = at(i, j, k).unwrap();
        let mut go = |a: i32, b: i32, c: i32, q: &mut VecDeque<(i32, i32, i32)>| {
            if let Some(m2) = at(a, b, c) {
                if standable(w.rules.kind[m2]) && !reach[idx(a, b, c)] {
                    reach[idx(a, b, c)] = true;
                    q.push_back((a, b, c));
                }
            }
        };
        for d in 0..4 {
            let (a, c) = (i + DX[d], k + DZ[d]);
            if let Some(m2) = at(a, j, c) {
                if passable(w.rules.face[m][d], w.rules.face[m2][OPP[d]]) {
                    go(a, j, c, &mut q);
                }
            }
            // a stair tower: open on its turned -x side, stacks upward
            let km = w.rules.kind[m];
            if matches!(km, Kind::TowerBase | Kind::TowerFlight | Kind::TowerHead) {
                let open = (2 + w.rules.mods[m].rot as usize) % 4;
                if d == open {
                    for jj in [j, j + 1] {
                        if let Some(m2) = at(a, jj, c) {
                            if w.rules.kind[m2].floor().is_some() || w.rules.kind[m2].is_deck() {
                                go(a, jj, c, &mut q);
                            }
                        }
                    }
                }
                if d == 0 {
                    if let Some(m2) = at(i, j + 1, k) {
                        if matches!(w.rules.kind[m2], Kind::TowerFlight | Kind::TowerHead) {
                            go(i, j + 1, k, &mut q);
                        }
                    }
                }
            }
            if let Some(m2) = at(a, j, c) {
                let k2 = w.rules.kind[m2];
                if matches!(k2, Kind::TowerBase | Kind::TowerFlight | Kind::TowerHead) && (2 + w.rules.mods[m2].rot as usize) % 4 == OPP[d] {
                    go(a, j, c, &mut q);
                }
            }
            if let Some(m2) = at(a, j - 1, c) {
                let k2 = w.rules.kind[m2];
                if matches!(k2, Kind::TowerBase | Kind::TowerFlight | Kind::TowerHead) && (2 + w.rules.mods[m2].rot as usize) % 4 == OPP[d] && at(a, j, c).map_or(true, |x| w.rules.kind[x] != Kind::TowerFlight) {
                    go(a, j - 1, c, &mut q);
                }
            }
            if d == 0 && j > 0 && matches!(km, Kind::TowerFlight | Kind::TowerHead) {
                go(i, j - 1, k, &mut q);
            }
            // up: a stair top with its WL side toward d
            if w.rules.kind[m].is_climb() && w.rules.face[m][d] == WL {
                go(a, j + 1, c, &mut q);
            }
            // down: the cell below in direction d is a stair top facing us
            if let Some(m2) = at(a, j - 1, c) {
                if w.rules.kind[m2].is_climb() && w.rules.face[m2][OPP[d]] == WL {
                    go(a, j - 1, c, &mut q);
                }
            }
        }
    }
    let ground_reached = (0..n * n).filter(|&c| reach[c as usize]).count();
    println!("cells reached on layer 0: {}", ground_reached);
    let mut roofs = 0;
    let mut roofs_reached = 0;
    let mut levels = vec![0usize; h as usize];
    for k in 0..n {
        for i in 0..n {
            for j in 1..h {
                let m = at(i, j, k).unwrap();
                if w.rules.kind[m].floor().is_some() {
                    roofs += 1;
                    if reach[idx(i, j, k)] {
                        roofs_reached += 1;
                        levels[j as usize] += 1;
                    }
                }
            }
        }
    }
    let used = use_m.iter().filter(|&&c| c > 0).count();
    // normalised entropy of the prototype use (excluding air)
    let air_p = w.rules.protos.iter().position(|p| p.name == "air").unwrap();
    let nonair: f64 = use_p.iter().enumerate().filter(|(p, _)| *p != air_p).map(|(_, &c)| c as f64).sum();
    let mut ent = 0.0;
    let mut kinds = 0;
    for (p, &c) in use_p.iter().enumerate() {
        if p == air_p || c == 0 {
            continue;
        }
        kinds += 1;
        let f = c as f64 / nonair;
        ent -= f * f.ln();
    }
    let spread = if kinds > 1 { ent / (w.rules.protos.len() as f64 - 1.0).ln() } else { 0.0 };
    let mut usage: Vec<(String, usize)> = use_p.iter().enumerate().map(|(p, &c)| (w.rules.protos[p].name.to_string(), c)).collect();
    usage.sort_by(|a, b| b.1.cmp(&a.1));
    Quality {
        air: air as f64 / total as f64,
        mass_by_layer: mass_l.iter().map(|&c| c as f64 / (n * n) as f64).collect(),
        heights,
        buildings: sizes.len(),
        footprint: sizes.iter().sum::<usize>() as f64 / sizes.len().max(1) as f64,
        roofs,
        roofs_reached,
        levels_reached: levels,
        climbs_per_100: climbs as f64 * 100.0 / (n * n) as f64,
        used,
        spread,
        usage,
        ground_open: ground_open as f64 / (n * n) as f64,
    }
}

#[test]
fn quality_report() {
    let mut agg_reach = 0.0;
    let mut agg_air = 0.0;
    for seed in [1u32, 2, 3] {
        let w = gen_area(seed);
        let q = quality(&w);
        println!("── quality seed {} ({} x {} x {}) ──", seed, AREA, w.h, AREA);
        println!("air fraction {:.3}; open ground fraction {:.3}", q.air, q.ground_open);
        println!("block fraction by layer {:?}", q.mass_by_layer.iter().map(|x| (x * 100.0).round() / 100.0).collect::<Vec<_>>());
        println!("column height histogram (blocks per column 0..12) {:?}", q.heights);
        println!("buildings {} mean footprint {:.1} cells", q.buildings, q.footprint);
        println!(
            "roof floors {} reached from the street {} ({:.1}%), by level {:?}",
            q.roofs,
            q.roofs_reached,
            100.0 * q.roofs_reached as f64 / q.roofs.max(1) as f64,
            q.levels_reached
        );
        println!("stairs and ramps per 100 columns {:.1}", q.climbs_per_100);
        println!("modules used {} of {}; prototype spread (norm. entropy, no air) {:.2}", q.used, w.rules.n(), q.spread);
        println!("top use: {:?}", &q.usage[..12]);
        println!("unused: {:?}", q.usage.iter().filter(|u| u.1 == 0).map(|u| u.0.clone()).collect::<Vec<_>>());
        agg_reach += q.roofs_reached as f64 / q.roofs.max(1) as f64;
        agg_air += q.air;
        assert!(q.buildings > 20);
        assert!(q.levels_reached.iter().skip(3).any(|&c| c > 0), "a walker must climb to level 3 or higher");
    }
    println!("mean roofs reached {:.1}%, mean air {:.3}", agg_reach / 3.0 * 100.0, agg_air / 3.0);
}

#[test]
fn ascii_map() {
    let w = gen_area(1);
    let mut s = String::new();
    for k in 0..40 {
        for i in 0..64 {
            let mut top = 0;
            let mut ch = '.';
            for j in (0..12).rev() {
                let m = w.module_at(i, j, k).unwrap();
                let kd = w.rules.kind[m];
                if kd == Kind::Mass {
                    top = j + 1;
                    break;
                }
                if j == 0 {
                    ch = match kd {
                        Kind::Street => ',',
                        Kind::Road | Kind::RoadGate => '.',
                        Kind::TowerBase => '#',
                        Kind::Plaza | Kind::Fountain | Kind::Stall => ',',
                        Kind::Lawn | Kind::Tree => '"',
                        k if k.is_canal() => '~',
                        k if k.is_climb() => '/',
                        _ => ':',
                    };
                }
            }
            if top > 0 {
                ch = std::char::from_digit(top.min(35) as u32, 36).unwrap();
            }
            s.push(ch);
        }
        s.push('\n');
    }
    println!("height map (digit = block storeys):\n{}", s);
}

