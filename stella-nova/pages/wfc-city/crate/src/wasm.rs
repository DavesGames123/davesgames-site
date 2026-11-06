//! The wasm-bindgen API that the page calls (see CONTRACT.md).
//!
//!   new World(seed, height)
//!   update(px, py, pz, radius_cells, budget) -> u32
//!   dirty_chunks() -> Int32Array, chunk_mesh(cx, cz) -> Float32Array
//!   forget_far(px, pz, keep_radius_cells) -> Int32Array
//!   move_body(state, dt, radius, height, fly), ground_height(x, z)
//!   counter(), stats(), palette(), module_count(), prototype_name(i),
//!   slot_info(i, j, k), version()

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn perf_now() -> f64;
}

#[wasm_bindgen]
pub struct World {
    w: crate::world::World,
}

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, height: u32) -> World {
        World { w: crate::world::World::new(seed, height) }
    }

    pub fn update(&mut self, px: f32, _py: f32, pz: f32, radius_cells: u32, budget: u32) -> u32 {
        let t0 = perf_now();
        let n = self.w.update(px, pz, radius_cells, budget);
        self.w.last_ms = (perf_now() - t0) as f32;
        n
    }

    pub fn dirty_chunks(&mut self) -> Vec<i32> {
        self.w.take_dirty()
    }

    pub fn chunk_mesh(&self, cx: i32, cz: i32) -> Vec<f32> {
        crate::mesher::chunk_mesh(&self.w, cx, cz)
    }

    pub fn forget_far(&mut self, px: f32, pz: f32, keep_radius_cells: u32) -> Vec<i32> {
        self.w.forget_far(px, pz, keep_radius_cells)
    }

    pub fn move_body(&self, state: &mut [f32], dt: f32, radius: f32, height: f32, fly: bool) {
        crate::body::move_body(&self.w, state, dt, radius, height, fly);
    }

    pub fn ground_height(&self, x: f32, z: f32) -> f32 {
        crate::body::ground_height(&self.w, x, z)
    }

    pub fn counter(&self) -> u32 {
        self.w.counter
    }

    pub fn stats(&self) -> Vec<f32> {
        self.w.stats()
    }

    pub fn palette(&self) -> Vec<f32> {
        crate::modules::palette_linear()
    }

    pub fn module_count(&self) -> u32 {
        self.w.rules.n() as u32
    }

    pub fn prototype_count(&self) -> u32 {
        self.w.rules.protos.len() as u32
    }

    pub fn prototype_name(&self, i: u32) -> String {
        self.w.rules.protos.get(i as usize).map(|p| p.name.to_string()).unwrap_or_default()
    }

    pub fn slot_info(&self, i: i32, j: i32, k: i32) -> Vec<i32> {
        self.w.slot_info(i, j, k)
    }

    pub fn height(&self) -> u32 {
        self.w.h as u32
    }

    pub fn repairs(&self) -> u32 {
        self.w.repairs as u32
    }
}

#[wasm_bindgen]
pub fn version() -> String {
    crate::VERSION.to_string()
}
