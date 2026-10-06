//! The random source of the examples and of the random textures.
//!
//! ln uses Go math/rand (a global source). This port does not copy the Go
//! generator, so a seeded layout is not the same as the Go output. Each
//! shape or example gets its own seeded Rng, so a render is repeatable.
//! The generator is SplitMix64.

#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng { state: seed ^ 0x9E37_79B9_7F4A_7C15 }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A float in [0, 1), as Go rand.Float64.
    pub fn float64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// An integer in [0, n), as Go rand.Intn.
    pub fn intn(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        (self.float64() * n as f64) as usize % n
    }
}
