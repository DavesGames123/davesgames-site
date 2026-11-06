//! The seeded random generator, the cell hashes and a fast hasher.
//!
//! The solver must give the same city for the same seed and the same
//! sequence of `update` calls. Thus all random choices come from one
//! splitmix64 stream, and the hash map uses a fixed hasher. No code reads
//! the iteration order of a hash map to make a decision.

use std::hash::{BuildHasherDefault, Hasher};

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x2545_F491_4F6C_DD1D) ^ 0x9E37_79B9_7F4A_7C15)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// A float in [0, 1).
    pub fn f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }
}

/// A 32 bit hash of a seed and three cell coordinates.
pub fn hash3(seed: u32, i: i32, j: i32, k: i32) -> u32 {
    let mut h = (seed as u64) ^ 0x51_7CC1_B727_220A;
    for v in [i as u32 as u64, j as u32 as u64, k as u32 as u64] {
        h ^= v.wrapping_add(0x9E37_79B9_7F4A_7C15).wrapping_add(h << 6).wrapping_add(h >> 2);
        h = h.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
        h ^= h >> 33;
    }
    (h ^ (h >> 29)) as u32
}

/// A hash in [0, 1).
pub fn hashf(seed: u32, i: i32, j: i32, k: i32) -> f32 {
    (hash3(seed, i, j, k) >> 8) as f32 / (1u32 << 24) as f32
}

/// A small multiply and rotate hasher for integer keys.
#[derive(Default, Clone, Copy)]
pub struct Fx(u64);

impl Hasher for Fx {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }
    fn write_u32(&mut self, v: u32) {
        self.write_u64(v as u64);
    }
    fn write_i32(&mut self, v: i32) {
        self.write_u64(v as u32 as u64);
    }
    fn write_u64(&mut self, v: u64) {
        self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(0x51_7CC1_B727_220A);
    }
}

pub type FxBuild = BuildHasherDefault<Fx>;
