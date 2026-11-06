//! The lazy infinite map and the solver.
//!
//! Slots live in chunks of 8 x 8 cells (full height). The chunk map is a
//! hash map from (cx, cz) to an index in `chunks`. A fresh chunk starts
//! with the layer domains of `Rules::init`, then the constraints of its
//! existing neighbours flow in. Propagation only visits slots of existing
//! chunks, so it cannot run away along a canal or a gable row. `update`
//! makes the chunks within radius + 8 cells, and collapses slots within
//! the radius only. Thus the edge of the collapsed area always touches
//! open slots, which gives the solver room.
//!
//! One collapse: pick the open slot with the lowest score (Shannon
//! entropy + a seeded noise + a small layer and distance bias) in the
//! nearest chunk that has candidates, choose a module by weight, then run
//! arc consistency (`propagate`). Each domain change goes on the trail
//! (the old domain, module and birth). A contradiction (an empty domain)
//! starts `resolve`: undo to the last decision and ban its module. After
//! K failures in a row, undo more decisions in one step. When no decision
//! is left, `repair` clears a box of slots round the conflict and builds
//! the constraints again. A failing repair grows the box. The last resort
//! resets every slot, which is always consistent. So no collapsed slot
//! ever keeps a contradiction, and no area stays stuck.
//!
//! The making of a chunk, `repair` and `forget_far` commit the trail
//! (they clear it). Thus an undo never removes constraints that came
//! from a chunk that was made after the decision.
//!
//! Determinism: one RNG stream; chunk order sorted by (distance, cx, cz);
//! the dirty list is a BTreeSet. Nothing reads the hash map order.

use crate::modules::*;
use crate::rng::{hashf, FxBuild, Rng};
use std::collections::{BTreeSet, HashMap};

pub const CS: i32 = 8;
const NB_NONE: u32 = u32::MAX;
const FAIL_K: u32 = 6;
const STUCK_LIMIT: u32 = 300;

pub struct Chunk {
    pub cx: i32,
    pub cz: i32,
    pub dom: Vec<Dom>,
    pub module: Vec<u16>,
    pub birth: Vec<u32>,
    pub ent: Vec<f32>,
    pub noise: Vec<f32>,
    pub queued: Vec<bool>,
    pub nb: [u32; 4],
    pub alive: bool,
    pub open: u32,
}

struct Trail {
    c: u32,
    l: u16,
    dom: Dom,
    module: u16,
    birth: u32,
    ent: f32,
}

struct Decision {
    c: u32,
    l: u16,
    m: u16,
    trail: usize,
}

pub struct World {
    pub rules: Rules,
    pub h: usize,
    pub seed: u32,
    rng: Rng,
    pub chunks: Vec<Chunk>,
    free: Vec<u32>,
    pub map: HashMap<(i32, i32), u32, FxBuild>,
    trail: Vec<Trail>,
    decisions: Vec<Decision>,
    queue: Vec<(u32, u16)>,
    pub counter: u32,
    pub n_collapsed: u64,
    pub backtracks: u64,
    pub contradictions: u64,
    pub repairs: u64,
    pub full_resets: u64,
    dirty: BTreeSet<(i32, i32)>,
    conflict: Option<(u32, u16)>,
    fails: u32,
    /// Backtracks since the collapsed count last reached a new maximum.
    stuck: u32,
    best: u64,
    /// Repairs in a row without progress (grows the repair box).
    streak: usize,
    pub last_ms: f32,
    /// Score added per layer: a positive value builds from the ground up.
    pub layer_bias: f32,
}

impl World {
    pub fn new(seed: u32, height: u32) -> World {
        let h = if height == 0 { 12 } else { height as usize };
        let rules = Rules::new(h);
        let h = rules.h;
        World {
            rules,
            h,
            seed,
            rng: Rng::new(seed as u64 ^ 0xC17C_0FFE),
            chunks: Vec::new(),
            free: Vec::new(),
            map: HashMap::default(),
            trail: Vec::new(),
            decisions: Vec::new(),
            queue: Vec::new(),
            counter: 1,
            n_collapsed: 0,
            backtracks: 0,
            contradictions: 0,
            repairs: 0,
            full_resets: 0,
            dirty: BTreeSet::new(),
            conflict: None,
            fails: 0,
            stuck: 0,
            best: 0,
            streak: 0,
            last_ms: 0.0,
            layer_bias: 4.0,
        }
    }

    // ── addressing ──────────────────────────────────────────────────────

    #[inline]
    pub fn local(&self, lx: usize, lz: usize, j: usize) -> u16 {
        ((lz * 8 + lx) * self.h + j) as u16
    }

    /// World cell of a slot.
    #[inline]
    pub fn cell_of(&self, c: u32, l: u16) -> (i32, i32, i32) {
        let ch = &self.chunks[c as usize];
        let h = self.h;
        let j = l as usize % h;
        let col = l as usize / h;
        (ch.cx * CS + (col % 8) as i32, j as i32, ch.cz * CS + (col / 8) as i32)
    }

    pub fn slot_ref(&self, i: i32, j: i32, k: i32) -> Option<(u32, u16)> {
        if j < 0 || j as usize >= self.h {
            return None;
        }
        let cx = i.div_euclid(CS);
        let cz = k.div_euclid(CS);
        let c = *self.map.get(&(cx, cz))?;
        let lx = i.rem_euclid(CS) as usize;
        let lz = k.rem_euclid(CS) as usize;
        Some((c, self.local(lx, lz, j as usize)))
    }

    /// The collapsed module at a cell, if any.
    #[inline]
    pub fn module_at(&self, i: i32, j: i32, k: i32) -> Option<usize> {
        let (c, l) = self.slot_ref(i, j, k)?;
        let m = self.chunks[c as usize].module[l as usize];
        if m == NONE {
            None
        } else {
            Some(m as usize)
        }
    }

    #[inline]
    fn nb(&self, c: u32, l: u16, d: usize) -> Option<(u32, u16)> {
        let h = self.h;
        let li = l as usize;
        let j = li % h;
        let col = li / h;
        let lx = col % 8;
        let lz = col / 8;
        match d {
            4 => {
                if j + 1 < h {
                    Some((c, l + 1))
                } else {
                    None
                }
            }
            5 => {
                if j > 0 {
                    Some((c, l - 1))
                } else {
                    None
                }
            }
            0 => {
                if lx < 7 {
                    Some((c, (li + h) as u16))
                } else {
                    let o = self.chunks[c as usize].nb[0];
                    if o == NB_NONE {
                        None
                    } else {
                        Some((o, self.local(0, lz, j)))
                    }
                }
            }
            2 => {
                if lx > 0 {
                    Some((c, (li - h) as u16))
                } else {
                    let o = self.chunks[c as usize].nb[2];
                    if o == NB_NONE {
                        None
                    } else {
                        Some((o, self.local(7, lz, j)))
                    }
                }
            }
            1 => {
                if lz < 7 {
                    Some((c, (li + 8 * h) as u16))
                } else {
                    let o = self.chunks[c as usize].nb[1];
                    if o == NB_NONE {
                        None
                    } else {
                        Some((o, self.local(lx, 0, j)))
                    }
                }
            }
            _ => {
                if lz > 0 {
                    Some((c, (li - 8 * h) as u16))
                } else {
                    let o = self.chunks[c as usize].nb[3];
                    if o == NB_NONE {
                        None
                    } else {
                        Some((o, self.local(lx, 7, j)))
                    }
                }
            }
        }
    }

    fn mark_dirty(&mut self, c: u32, l: u16) {
        let ch = &self.chunks[c as usize];
        let col = l as usize / self.h;
        let (lx, lz) = (col % 8, col / 8);
        let (cx, cz) = (ch.cx, ch.cz);
        self.dirty.insert((cx, cz));
        if lx == 0 {
            self.dirty.insert((cx - 1, cz));
        }
        if lx == 7 {
            self.dirty.insert((cx + 1, cz));
        }
        if lz == 0 {
            self.dirty.insert((cx, cz - 1));
        }
        if lz == 7 {
            self.dirty.insert((cx, cz + 1));
        }
    }

    // ── trail ───────────────────────────────────────────────────────────

    #[inline]
    fn log(&mut self, c: u32, l: u16) {
        let ch = &self.chunks[c as usize];
        let li = l as usize;
        self.trail.push(Trail { c, l, dom: ch.dom[li], module: ch.module[li], birth: ch.birth[li], ent: ch.ent[li] });
    }

    fn undo_to(&mut self, pos: usize) {
        while self.trail.len() > pos {
            let t = self.trail.pop().unwrap();
            let li = t.l as usize;
            let was = self.chunks[t.c as usize].module[li];
            {
                let ch = &mut self.chunks[t.c as usize];
                ch.dom[li] = t.dom;
                ch.module[li] = t.module;
                ch.birth[li] = t.birth;
                ch.ent[li] = t.ent;
            }
            if was != NONE && t.module == NONE {
                self.chunks[t.c as usize].open += 1;
                self.n_collapsed -= 1;
                self.mark_dirty(t.c, t.l);
            }
        }
    }

    fn commit(&mut self) {
        self.trail.clear();
        self.decisions.clear();
        self.fails = 0;
    }

    fn trim(&mut self) {
        if self.decisions.len() <= 256 {
            return;
        }
        let cut = 128;
        let pos = self.decisions[cut].trail;
        self.trail.drain(0..pos);
        self.decisions.drain(0..cut);
        for d in self.decisions.iter_mut() {
            d.trail -= pos;
        }
    }

    // ── chunks ──────────────────────────────────────────────────────────

    fn create_chunk(&mut self, cx: i32, cz: i32) {
        let h = self.h;
        let n = 64 * h;
        let mut ch = Chunk {
            cx,
            cz,
            dom: vec![ZERO; n],
            module: vec![NONE; n],
            birth: vec![0; n],
            ent: vec![0.0; n],
            noise: vec![0.0; n],
            queued: vec![false; n],
            nb: [NB_NONE; 4],
            alive: true,
            open: n as u32,
        };
        for lz in 0..8 {
            for lx in 0..8 {
                for j in 0..h {
                    let l = (lz * 8 + lx) * h + j;
                    ch.dom[l] = self.rules.init[j];
                    ch.ent[l] = self.rules.init_ent[j];
                    ch.noise[l] = hashf(self.seed, cx * CS + lx as i32, j as i32, cz * CS + lz as i32) * 0.06;
                }
            }
        }
        let idx = if let Some(f) = self.free.pop() {
            self.chunks[f as usize] = ch;
            f
        } else {
            self.chunks.push(ch);
            (self.chunks.len() - 1) as u32
        };
        self.map.insert((cx, cz), idx);
        for d in 0..4 {
            let key = (cx + DX[d], cz + DZ[d]);
            if let Some(&o) = self.map.get(&key) {
                self.chunks[idx as usize].nb[d] = o;
                self.chunks[o as usize].nb[OPP[d]] = idx;
                // the slots of `o` that face the new chunk
                for t in 0..8 {
                    for j in 0..h {
                        let (lx, lz) = match d {
                            0 => (0, t),
                            2 => (7, t),
                            1 => (t, 0),
                            _ => (t, 7),
                        };
                        let l = self.local(lx, lz, j);
                        self.push(o, l);
                    }
                }
            }
        }
        if !self.propagate() {
            let at = self.conflict.unwrap();
            self.repair(at);
        }
        self.commit();
    }

    fn chunk_dist(cx: i32, cz: i32, fi: f32, fk: f32) -> f32 {
        let x0 = (cx * CS) as f32;
        let z0 = (cz * CS) as f32;
        let dx = (x0 - fi).max(fi - (x0 + CS as f32)).max(0.0);
        let dz = (z0 - fk).max(fk - (z0 + CS as f32)).max(0.0);
        (dx * dx + dz * dz).sqrt()
    }

    fn ensure(&mut self, fi: f32, fk: f32, reach: f32) {
        let c0 = ((fi - reach) / CS as f32).floor() as i32;
        let c1 = ((fi + reach) / CS as f32).floor() as i32;
        let d0 = ((fk - reach) / CS as f32).floor() as i32;
        let d1 = ((fk + reach) / CS as f32).floor() as i32;
        let mut need: Vec<(f32, i32, i32)> = Vec::new();
        for cz in d0..=d1 {
            for cx in c0..=c1 {
                let d = Self::chunk_dist(cx, cz, fi, fk);
                if d <= reach && !self.map.contains_key(&(cx, cz)) {
                    need.push((d, cx, cz));
                }
            }
        }
        if need.is_empty() {
            return;
        }
        need.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        self.commit();
        for (_, cx, cz) in need {
            self.create_chunk(cx, cz);
        }
    }

    // ── propagation ─────────────────────────────────────────────────────

    #[inline]
    fn push(&mut self, c: u32, l: u16) {
        let q = &mut self.chunks[c as usize].queued[l as usize];
        if !*q {
            *q = true;
            self.queue.push((c, l));
        }
    }

    fn clear_queue(&mut self) {
        while let Some((c, l)) = self.queue.pop() {
            self.chunks[c as usize].queued[l as usize] = false;
        }
    }

    /// Arc consistency over the slots of the existing chunks. Returns false
    /// on a contradiction and keeps the slot in `conflict`.
    fn propagate(&mut self) -> bool {
        let h = self.h;
        while let Some((c, l)) = self.queue.pop() {
            self.chunks[c as usize].queued[l as usize] = false;
            let dom = self.chunks[c as usize].dom[l as usize];
            let j = l as usize % h;
            let init_case = dom == self.rules.init[j];
            for d in 0..6 {
                let Some((nc, nl)) = self.nb(c, l, d) else { continue };
                let sup = if init_case { self.rules.init_sup[j][d] } else { self.rules.support(&dom, d) };
                let old = self.chunks[nc as usize].dom[nl as usize];
                let new = dom_and(&old, &sup);
                if new != old {
                    if dom_zero(&new) {
                        self.conflict = Some((nc, nl));
                        self.clear_queue();
                        return false;
                    }
                    self.log(nc, nl);
                    let nj = nl as usize % h;
                    let e = self.rules.entropy(&new, nj);
                    let ch = &mut self.chunks[nc as usize];
                    ch.dom[nl as usize] = new;
                    ch.ent[nl as usize] = e;
                    self.push(nc, nl);
                }
            }
        }
        true
    }

    // ── collapse, backtrack, repair ─────────────────────────────────────

    fn pick(&self, c: u32, fi: f32, fk: f32, r: f32) -> Option<u16> {
        let ch = &self.chunks[c as usize];
        if ch.open == 0 {
            return None;
        }
        let h = self.h;
        let mut best = None;
        let mut best_s = f32::INFINITY;
        for lz in 0..8 {
            for lx in 0..8 {
                let dx = (ch.cx * CS + lx) as f32 + 0.5 - fi;
                let dz = (ch.cz * CS + lz) as f32 + 0.5 - fk;
                let d2 = dx * dx + dz * dz;
                if d2 > r * r {
                    continue;
                }
                let dist = d2.sqrt();
                let base = ((lz * 8 + lx) as usize) * h;
                for j in 0..h {
                    let l = base + j;
                    if ch.module[l] != NONE {
                        continue;
                    }
                    let s = ch.ent[l] + ch.noise[l] + 0.004 * dist + self.layer_bias * j as f32;
                    if s < best_s {
                        best_s = s;
                        best = Some(l as u16);
                    }
                }
            }
        }
        best
    }

    fn set_collapsed(&mut self, c: u32, l: u16, m: usize) {
        self.log(c, l);
        let birth = self.counter;
        self.counter = self.counter.wrapping_add(1);
        let mut d = ZERO;
        dom_set(&mut d, m);
        let ch = &mut self.chunks[c as usize];
        let li = l as usize;
        ch.dom[li] = d;
        ch.module[li] = m as u16;
        ch.birth[li] = birth;
        ch.ent[li] = 0.0;
        ch.open -= 1;
        self.n_collapsed += 1;
        self.mark_dirty(c, l);
    }

    fn collapse(&mut self, c: u32, l: u16) {
        let j = l as usize % self.h;
        let dom = self.chunks[c as usize].dom[l as usize];
        let wt = &self.rules.wt[j];
        let total: f32 = dom_iter(&dom).map(|m| wt[m]).sum();
        let mut x = self.rng.f32() * total;
        let mut pick = dom_first(&dom);
        for m in dom_iter(&dom) {
            pick = m;
            x -= wt[m];
            if x <= 0.0 {
                break;
            }
        }
        self.decisions.push(Decision { c, l, m: pick as u16, trail: self.trail.len() });
        self.set_collapsed(c, l, pick);
        self.push(c, l);
        if self.propagate() {
            self.fails = 0;
        } else {
            self.resolve();
        }
        if self.n_collapsed > self.best {
            self.best = self.n_collapsed;
            self.stuck = 0;
            self.streak = 0;
        }
        self.trim();
    }

    /// Backtracking after a contradiction.
    fn resolve(&mut self) {
        loop {
            self.contradictions += 1;
            self.fails += 1;
            let extra = if self.fails > FAIL_K { ((self.fails - FAIL_K) as usize).min(8) } else { 0 };
            let Some(mut d) = self.decisions.pop() else {
                let at = self.conflict.unwrap();
                self.repair(at);
                return;
            };
            self.undo_to(d.trail);
            for _ in 0..extra {
                match self.decisions.pop() {
                    Some(e) => {
                        self.undo_to(e.trail);
                        d = e;
                    }
                    None => break,
                }
            }
            self.backtracks += 1;
            self.stuck += 1;
            if self.stuck > STUCK_LIMIT {
                // thrashing: no new progress for a long time
                self.stuck = 0;
                self.repair((d.c, d.l));
                return;
            }
            // ban the choice
            self.log(d.c, d.l);
            let li = d.l as usize;
            let j = li % self.h;
            let mut dom = self.chunks[d.c as usize].dom[li];
            dom_clear(&mut dom, d.m as usize);
            if dom_zero(&dom) {
                self.trail.pop();
                self.conflict = Some((d.c, d.l));
                continue;
            }
            let e = self.rules.entropy(&dom, j);
            self.chunks[d.c as usize].dom[li] = dom;
            self.chunks[d.c as usize].ent[li] = e;
            self.push(d.c, d.l);
            if self.propagate() {
                return;
            }
        }
    }

    fn reset_slot(&mut self, c: u32, l: u16) {
        let li = l as usize;
        let j = li % self.h;
        let was = self.chunks[c as usize].module[li];
        {
            let ch = &mut self.chunks[c as usize];
            ch.dom[li] = self.rules.init[j];
            ch.ent[li] = self.rules.init_ent[j];
            ch.module[li] = NONE;
        }
        if was != NONE {
            self.chunks[c as usize].open += 1;
            self.n_collapsed -= 1;
            self.mark_dirty(c, l);
        }
    }

    /// The last resort: clear a box of slots round the conflict and run
    /// the constraints again. Grow the box when that fails.
    fn repair(&mut self, at: (u32, u16)) {
        self.repairs += 1;
        self.commit();
        let (i0, _, k0) = self.cell_of(at.0, at.1);
        let h = self.h as i32;
        let radii = [2i32, 4, 7, 11];
        let first = self.streak.min(radii.len() - 1);
        self.streak += 1;
        for &r in &radii[first..] {
            for k in k0 - r..=k0 + r {
                for i in i0 - r..=i0 + r {
                    for j in 0..h {
                        if let Some((c, l)) = self.slot_ref(i, j, k) {
                            self.reset_slot(c, l);
                        }
                    }
                }
            }
            for k in k0 - r - 1..=k0 + r + 1 {
                for i in i0 - r - 1..=i0 + r + 1 {
                    for j in 0..h {
                        if let Some((c, l)) = self.slot_ref(i, j, k) {
                            self.push(c, l);
                        }
                    }
                }
            }
            if self.propagate() {
                self.commit();
                return;
            }
        }
        // every slot back to its layer domain: always consistent
        self.full_resets += 1;
        self.streak = 0;
        let n = 64 * self.h;
        for c in 0..self.chunks.len() as u32 {
            if !self.chunks[c as usize].alive {
                continue;
            }
            for l in 0..n {
                self.reset_slot(c, l as u16);
            }
        }
        self.best = 0;
        self.commit();
    }

    // ── public API ──────────────────────────────────────────────────────

    /// Collapse up to `budget` slots within `radius` cells of the focus
    /// (world metres). Returns the number of collapses (0 = area done).
    pub fn update(&mut self, px: f32, pz: f32, radius: u32, budget: u32) -> u32 {
        let fi = px / 2.0;
        let fk = pz / 2.0;
        let r = radius.max(1) as f32;
        self.ensure(fi, fk, r + CS as f32);
        let mut order: Vec<(f32, i32, i32, u32)> = Vec::new();
        for (&(cx, cz), &c) in self.map.iter() {
            let d = Self::chunk_dist(cx, cz, fi, fk);
            if d <= r {
                order.push((d, cx, cz, c));
            }
        }
        order.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut ptr = 0;
        let mut done = 0;
        while done < budget && ptr < order.len() {
            let c = order[ptr].3;
            match self.pick(c, fi, fk, r) {
                None => ptr += 1,
                Some(l) => {
                    let before = self.backtracks + self.repairs;
                    self.collapse(c, l);
                    done += 1;
                    if self.backtracks + self.repairs != before {
                        ptr = 0;
                    }
                }
            }
        }
        done
    }

    /// The chunks whose mesh changed since the last call.
    pub fn take_dirty(&mut self) -> Vec<i32> {
        let mut out = Vec::new();
        let set = std::mem::take(&mut self.dirty);
        for (cx, cz) in set {
            if self.map.contains_key(&(cx, cz)) {
                out.push(cx);
                out.push(cz);
            }
        }
        out
    }

    /// Drop the chunks farther than `keep` cells from the focus.
    pub fn forget_far(&mut self, px: f32, pz: f32, keep: u32) -> Vec<i32> {
        let fi = px / 2.0;
        let fk = pz / 2.0;
        let mut gone: Vec<(i32, i32, u32)> = self
            .map
            .iter()
            .filter(|(&(cx, cz), _)| Self::chunk_dist(cx, cz, fi, fk) > keep as f32)
            .map(|(&(cx, cz), &c)| (cx, cz, c))
            .collect();
        gone.sort();
        if gone.is_empty() {
            return Vec::new();
        }
        self.commit();
        let mut out = Vec::new();
        self.best = 0;
        for (cx, cz, c) in gone {
            for d in 0..4 {
                let o = self.chunks[c as usize].nb[d];
                if o != NB_NONE {
                    self.chunks[o as usize].nb[OPP[d]] = NB_NONE;
                }
            }
            self.map.remove(&(cx, cz));
            self.n_collapsed -= (64 * self.h as u32 - self.chunks[c as usize].open) as u64;
            let ch = &mut self.chunks[c as usize];
            ch.alive = false;
            ch.dom = Vec::new();
            ch.module = Vec::new();
            ch.birth = Vec::new();
            ch.ent = Vec::new();
            ch.noise = Vec::new();
            ch.queued = Vec::new();
            ch.nb = [NB_NONE; 4];
            self.free.push(c);
            self.dirty.remove(&(cx, cz));
            out.push(cx);
            out.push(cz);
        }
        out
    }

    pub fn live_chunks(&self) -> usize {
        self.map.len()
    }

    pub fn stats(&self) -> Vec<f32> {
        vec![
            self.n_collapsed as f32,
            self.backtracks as f32,
            self.contradictions as f32,
            (self.map.len() * 64 * self.h) as f32,
            self.map.len() as f32,
            self.rules.n() as f32,
            self.rules.protos.len() as f32,
            self.last_ms,
        ]
    }

    /// [state 0 none | 1 open | 2 collapsed, options left, module, prototype]
    pub fn slot_info(&self, i: i32, j: i32, k: i32) -> Vec<i32> {
        match self.slot_ref(i, j, k) {
            None => vec![0, 0, -1, -1],
            Some((c, l)) => {
                let ch = &self.chunks[c as usize];
                let m = ch.module[l as usize];
                let opts = dom_count(&ch.dom[l as usize]) as i32;
                if m == NONE {
                    vec![1, opts, -1, -1]
                } else {
                    vec![2, opts, m as i32, self.rules.mods[m as usize].proto as i32]
                }
            }
        }
    }

    /// Debug: true if every collapsed pair of neighbours is compatible.
    pub fn check_pair(&self, a: usize, b: usize, d: usize) -> bool {
        dom_has(&self.rules.single_sup[a][d], b)
    }
}
