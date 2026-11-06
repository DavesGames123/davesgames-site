//! The module set: connectors, prototypes, rotations and adjacency.
//!
//! A prototype has 6 face connectors, a kind (its geometry) and a weight
//! for each layer band. The expansion turns each prototype 0..rots-1
//! quarter turns about y. One turned prototype is a module.
//!
//! Horizontal connectors tell what crosses the face. Two faces can touch
//! when `h_compat` accepts the pair. The pair (KP, KM) and the pair
//! (RP, RM) are directed: the foot of a stair must meet the top of a
//! stair, never a second foot. The vertical connector VT carries the
//! rotation of its module: a stair top with rotation r accepts only the
//! landing with rotation r above it. Adjacency comes from the connectors
//! only. There is no table of module pairs.
//!
//! The layer rules: below layer 0 is earth (the top connector VM), above
//! layer H-1 is sky (the bottom connector VA). A prototype with weight 0
//! in a band is not allowed in that band. `Rules::new` then runs arc
//! consistency on one column with itself as the horizontal neighbour, and
//! gives the initial domain of a fresh slot at each layer.
//!
//! GREP MAP
//!   grep -n 'fn h_compat'      horizontal rules
//!   grep -n 'fn v_compat'      vertical rules
//!   grep -n 'fn protos'        the prototype table (weights per band)
//!   grep -n 'fn build_static'  the geometry of each kind
//!   grep -n 'fn static_boxes'  the collision boxes of each kind
//!   grep -n 'fn wall_px'       a wall with recessed openings
//!   grep -n 'PALETTE_SRGB'     the 16 colours

use crate::geom::{rot_box, B, NX, NY, NZ, PX, PY, PZ};

pub const W: usize = 4;
pub type Dom = [u64; W];
pub const ZERO: Dom = [0; W];
pub const NONE: u16 = 0xFFFF;

// ── horizontal connectors ───────────────────────────────────────────────
pub const O: u8 = 0; // open air side
pub const F: u8 = 1; // facade wall of a storey block (more blocks above)
pub const M: u8 = 2; // storey block mass continues
pub const R: u8 = 3; // floor continues at the base of the cell
pub const D: u8 = 4; // walkway deck continues
pub const L: u8 = 5; // low end of a stair or a ramp
pub const KP: u8 = 6; // stair foot, high end (mid height)
pub const KM: u8 = 7; // stair top, low end (mid height)
pub const WL: u8 = 8; // top end of a stair: against a top storey wall
pub const HD: u8 = 9; // landing above a stair, exit side
pub const WA: u8 = 10; // canal water continues
pub const G: u8 = 11; // gable roof ridge continues
pub const AR: u8 = 12; // arcade gallery continues
pub const RP: u8 = 13; // ramp foot, high end
pub const RM: u8 = 14; // ramp top, low end
pub const MT: u8 = 15; // top storey block mass continues (same roof line)
pub const FT: u8 = 16; // facade wall of a top storey block
pub const WB: u8 = 17; // back of a balcony: against any facade
pub const AB: u8 = 18; // end of an arch bridge: against a top storey wall
pub const GW: u8 = 19; // side of a gateway: against a storey wall
pub const AK: u8 = 20; // back of an arcade: against a storey wall
pub const SB: u8 = 21; // setback: a storey block beside a lower roof line
pub const ST: u8 = 22; // setback: the top storey block below that roof line
pub const S: u8 = 23; // road carriageway continues
pub const TB: u8 = 24; // back of a stair tower base: against a wall
pub const TF: u8 = 25; // open side of a stair tower flight: a wall
pub const TR: u8 = 26; // open side of a stair tower head: a roof floor
pub const NH: usize = 27;

// ── vertical connectors ─────────────────────────────────────────────────
pub const VM: u8 = 0; // top of a storey block: a block must follow
pub const VA: u8 = 1; // clear air
pub const VA2: u8 = 2; // top of a tall object: only plain air above
pub const VU: u8 = 3; // underside of a deck or a balcony
pub const VB: u8 = 4; // bottom of a block
pub const VR: u8 = 5; // roof: top of a top storey block, bottom of a floor
pub const VS: u8 = 6; // top of an arch bridge: floors only, no blocks
pub const VQ: u8 = 12; // stair tower continues (or air above its top)
pub const VT: u8 = 8; // stair top to landing, plus the rotation (8..11)
/// The earth below layer 0 (not a module connector).
pub const VE: u8 = 7;

/// Can face `a` of one cell touch face `b` of its horizontal neighbour?
pub fn h_compat(a: u8, b: u8) -> bool {
    let (a, b) = if a <= b { (a, b) } else { (b, a) };
    matches!(
        (a, b),
        (O, O)
            | (O, F)
            | (O, R)
            | (O, FT)
            | (F, R)
            | (F, D)
            | (F, WB)
            | (M, M)
            | (R, R)
            | (R, D)
            | (R, L)
            | (R, HD)
            | (R, AR)
            | (R, FT)
            | (D, D)
            | (D, L)
            | (D, FT)
            | (KP, KM)
            | (WL, FT)
            | (WA, WA)
            | (G, G)
            | (AR, AR)
            | (RP, RM)
            | (MT, MT)
            | (FT, WB)
            | (FT, AB)
            | (F, GW)
            | (F, AK)
            | (SB, ST)
            | (S, S)
            | (F, TB)
            | (FT, TB)
            | (F, TF)
            | (FT, TF)
            | (R, TR)
    )
}

/// Can a cell with top `top` carry a cell with bottom `bottom`?
pub fn v_compat(top: u8, bottom: u8) -> bool {
    match (top, bottom) {
        (VM, VB) | (VR, VB) | (VR, VR) | (VA, VA) | (VA2, VA) | (VA, VU) | (VE, VB) | (VE, VR) | (VS, VR) | (VQ, VQ) => true,
        (t, b) => (VT..VT + 4).contains(&t) && t == b,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Air,
    Mass,
    Street,
    Plaza,
    Lawn,
    Tree,
    Lamp,
    Bench,
    Fountain,
    Stall,
    Planter,
    Bollards,
    Roof,
    Garden,
    RoofTree,
    Chimney,
    Tank,
    Skylight,
    Mast,
    Solar,
    Parasol,
    Pergola,
    StairFoot,
    StairTop,
    StairSteep,
    RampFoot,
    RampTop,
    Landing,
    Walkway,
    WalkwayLamp,
    Gateway,
    ArchBridge,
    GableRidge,
    GableEnd,
    Hip,
    Dome,
    Spire,
    Balcony,
    Canal,
    CanalBridge,
    Arcade,
    Road,
    RoadGate,
    RoadBridge,
    TowerBase,
    TowerFlight,
    TowerHead,
}

impl Kind {
    /// (slab top, class) for floor kinds. Class: 0 street, 1 plaza,
    /// 2 green, 3 roof.
    pub fn floor(self) -> Option<(f32, u8)> {
        use Kind::*;
        match self {
            Street | Lamp | Bench | Bollards => Some((0.1, 0)),
            Road | RoadBridge | RoadGate => Some((0.05, 4)),
            Plaza | Fountain | Stall | Planter => Some((0.1, 1)),
            Lawn | Tree | Garden | RoofTree => Some((0.3, 2)),
            Roof | Chimney | Tank | Skylight | Mast | Solar | Parasol | Pergola => Some((0.1, 3)),
            _ => None,
        }
    }
    /// An open cell: a floor next to it needs a parapet.
    pub fn is_drop(self) -> bool {
        matches!(self, Kind::Air | Kind::Landing | Kind::Balcony | Kind::Walkway | Kind::WalkwayLamp | Kind::ArchBridge)
    }
    pub fn is_canal(self) -> bool {
        matches!(self, Kind::Canal | Kind::CanalBridge | Kind::RoadBridge)
    }
    pub fn is_climb(self) -> bool {
        matches!(self, Kind::StairFoot | Kind::StairTop | Kind::StairSteep | Kind::RampFoot | Kind::RampTop | Kind::TowerBase | Kind::TowerFlight | Kind::TowerHead)
    }
    pub fn is_deck(self) -> bool {
        matches!(self, Kind::Walkway | Kind::WalkwayLamp | Kind::Balcony)
    }
}

pub struct Proto {
    pub name: &'static str,
    pub kind: Kind,
    /// Side connectors at rotation 0: +x, +z, -x, -z.
    pub sides: [u8; 4],
    pub top: u8,
    pub bottom: u8,
    pub rots: u8,
    /// Weight per band: layer 0, layers 1-2, layers 3-5, layers 6 and up.
    pub w: [f32; 4],
    /// Allowed layers lo..=hi. A negative hi counts from the top (-1 = H-1).
    pub lo: i32,
    pub hi: i32,
}

/// Block weights above layer 0 are scaled by this factor. Over a storey
/// block only blocks fit, so the scale does not change the storey / top
/// storey ratio. Over a roof it sets how often a tower starts.
pub const TOWER_START: f32 = 0.06;

pub fn band(j: usize) -> usize {
    match j {
        0 => 0,
        1..=2 => 1,
        3..=5 => 2,
        _ => 3,
    }
}

#[allow(clippy::too_many_arguments)]
fn p(name: &'static str, kind: Kind, sides: [u8; 4], top: u8, bottom: u8, rots: u8, w: [f32; 4], lo: i32, hi: i32) -> Proto {
    Proto { name, kind, sides, top, bottom, rots, w, lo, hi }
}

/// The prototype table. Weights were tuned with the quality test
/// (`cargo test --release quality -- --nocapture`).
pub fn protos() -> Vec<Proto> {
    use Kind::*;
    let g0 = |w: f32| [w, 0.0, 0.0, 0.0];
    let up = |a: f32, b: f32, c: f32| [0.0, a, b, c];
    vec![
        p("air", Air, [O; 4], VA, VA, 1, [0.0, 3.0, 6.0, 12.0], 1, -1),
        // blocks: the side connectors give the footprint shape. A storey
        // block carries a block; a top storey block carries a roof. MT
        // sides keep one roof line over a whole building.
        p("block_core", Mass, [M; 4], VM, VB, 1, [0.2, 2.0, 1.6, 1.0], 0, -3),
        p("block_face", Mass, [F, M, M, M], VM, VB, 4, [0.9, 2.4, 1.9, 1.2], 0, -3),
        p("block_corner", Mass, [F, F, M, M], VM, VB, 4, [1.1, 1.7, 1.4, 1.0], 0, -3),
        p("block_slab", Mass, [F, M, F, M], VM, VB, 2, [0.08, 0.2, 0.2, 0.2], 0, -3),
        p("block_end", Mass, [F, F, F, M], VM, VB, 4, [0.1, 0.3, 0.35, 0.4], 0, -3),
        p("block_tower", Mass, [F; 4], VM, VB, 1, [0.06, 0.3, 0.5, 0.7], 0, -3),
        p("top_core", Mass, [MT; 4], VR, VB, 1, [0.15, 1.0, 1.0, 1.0], 0, -2),
        p("top_face", Mass, [FT, MT, MT, MT], VR, VB, 4, [0.6, 1.2, 1.2, 1.2], 0, -2),
        p("top_corner", Mass, [FT, FT, MT, MT], VR, VB, 4, [0.8, 0.85, 0.9, 1.0], 0, -2),
        p("top_slab", Mass, [FT, MT, FT, MT], VR, VB, 2, [0.03, 0.1, 0.12, 0.2], 0, -2),
        p("top_end", Mass, [FT, FT, FT, MT], VR, VB, 4, [0.03, 0.15, 0.2, 0.4], 0, -2),
        p("top_tower", Mass, [FT; 4], VR, VB, 1, [0.02, 0.15, 0.3, 0.7], 0, -2),
        // setbacks: a storey part (SB side) beside a top storey part (ST)
        p("setback_core", Mass, [SB, M, M, M], VM, VB, 4, [0.25, 0.3, 0.3, 0.2], 0, -3),
        p("setback_left", Mass, [SB, F, M, M], VM, VB, 4, [0.2, 0.25, 0.25, 0.2], 0, -3),
        p("setback_right", Mass, [SB, M, M, F], VM, VB, 4, [0.2, 0.25, 0.25, 0.2], 0, -3),
        p("setback_back", Mass, [SB, M, F, M], VM, VB, 4, [0.2, 0.25, 0.25, 0.2], 0, -3),
        p("terrace_core", Mass, [ST, MT, MT, MT], VR, VB, 4, [0.25, 0.3, 0.3, 0.2], 0, -2),
        p("terrace_left", Mass, [ST, FT, MT, MT], VR, VB, 4, [0.2, 0.25, 0.25, 0.2], 0, -2),
        p("terrace_right", Mass, [ST, MT, MT, FT], VR, VB, 4, [0.2, 0.25, 0.25, 0.2], 0, -2),
        p("terrace_back", Mass, [ST, MT, FT, MT], VR, VB, 4, [0.2, 0.25, 0.25, 0.2], 0, -2),
        // ground floors (layer 0)
        p("pavement", Street, [R; 4], VA, VR, 1, g0(4.0), 0, 0),
        // roads: S sides must meet S sides, so roads run as lines
        p("road", Road, [S, R, S, R], VA, VR, 2, g0(5.0), 0, 0),
        p("road_turn", Road, [S, S, R, R], VA, VR, 4, g0(0.4), 0, 0),
        p("road_tee", Road, [S, S, S, R], VA, VR, 4, g0(0.3), 0, 0),
        p("road_cross", Road, [S; 4], VA, VR, 1, g0(0.08), 0, 0),
        p("road_end", Road, [S, R, R, R], VA, VR, 4, g0(0.1), 0, 0),
        p("road_gate", RoadGate, [GW, S, GW, S], VM, VR, 2, g0(0.25), 0, 0),
        p("road_bridge", RoadBridge, [WA, S, WA, S], VA, VR, 2, g0(0.3), 0, 0),
        p("plaza", Plaza, [R; 4], VA, VR, 1, g0(1.6), 0, 0),
        p("lawn", Lawn, [R; 4], VA, VR, 1, g0(0.6), 0, 0),
        p("plane_tree", Tree, [R; 4], VA2, VR, 1, g0(1.0), 0, 0),
        p("lamp_post", Lamp, [R; 4], VA2, VR, 4, g0(0.7), 0, 0),
        p("bench", Bench, [R; 4], VA, VR, 4, g0(0.4), 0, 0),
        p("fountain", Fountain, [R; 4], VA, VR, 1, g0(0.15), 0, 0),
        p("market_stall", Stall, [R; 4], VA, VR, 4, g0(0.3), 0, 0),
        p("planter", Planter, [R; 4], VA, VR, 1, g0(0.3), 0, 0),
        p("bollards", Bollards, [R; 4], VA, VR, 2, g0(0.3), 0, 0),
        // roof floors (layer 1 and up)
        p("flat_roof", Roof, [R; 4], VA, VR, 1, up(1.6, 1.6, 1.6), 1, -1),
        p("roof_garden", Garden, [R; 4], VA, VR, 1, up(0.35, 0.3, 0.2), 1, -1),
        p("roof_tree", RoofTree, [R; 4], VA2, VR, 1, up(0.15, 0.12, 0.08), 1, -1),
        p("chimney", Chimney, [R; 4], VA2, VR, 1, up(0.25, 0.25, 0.2), 1, -1),
        p("water_tank", Tank, [R; 4], VA2, VR, 1, up(0.12, 0.2, 0.2), 1, -1),
        p("skylight", Skylight, [R; 4], VA, VR, 1, up(0.15, 0.15, 0.12), 1, -1),
        p("radio_mast", Mast, [R; 4], VA2, VR, 1, up(0.03, 0.08, 0.15), 1, -1),
        p("solar_rack", Solar, [R; 4], VA, VR, 4, up(0.15, 0.2, 0.2), 1, -1),
        p("parasol", Parasol, [R; 4], VA2, VR, 1, up(0.12, 0.1, 0.06), 1, -1),
        p("pergola", Pergola, [R; 4], VA2, VR, 2, up(0.12, 0.1, 0.06), 1, -1),
        // stairs and ramps: a two cell stair or ramp, or one steep stair
        p("stair_foot", StairFoot, [KP, O, L, O], VA, VR, 4, [3.0, 3.0, 2.6, 2.0], 0, -2),
        p("stair_top", StairTop, [WL, O, KM, O], VT, VR, 4, [3.0, 3.0, 2.6, 2.0], 0, -2),
        p("stair_steep", StairSteep, [WL, O, L, O], VT, VR, 4, [1.8, 1.8, 1.6, 1.2], 0, -2),
        p("ramp_foot", RampFoot, [RP, O, L, O], VA, VR, 4, [0.4, 0.3, 0.2, 0.1], 0, -2),
        p("ramp_top", RampTop, [WL, O, RM, O], VT, VR, 4, [0.4, 0.3, 0.2, 0.1], 0, -2),
        p("stair_landing", Landing, [HD, O, O, O], VA, VT, 4, up(1.0, 1.0, 1.0), 1, -1),
        // stair towers: a switchback stair that stacks; it opens on -x
        p("stair_tower_base", TowerBase, [O, O, TB, L], VQ, VR, 4, [2.4, 0.8, 0.5, 0.2], 0, -2),
        p("stair_tower", TowerFlight, [O, O, TF, O], VQ, VQ, 4, [0.0, 2.0, 2.0, 2.0], 1, -2),
        p("stair_tower_head", TowerHead, [O, O, TR, O], VA, VQ, 4, [0.0, 2.0, 2.0, 2.0], 1, -1),
        // walkways between roofs
        p("walkway", Walkway, [D, O, D, O], VA, VU, 2, up(0.06, 0.06, 0.05), 1, -2),
        p("walkway_lamp", WalkwayLamp, [D, O, D, O], VA2, VU, 2, up(0.015, 0.015, 0.012), 1, -2),
        p("walkway_turn", Walkway, [D, D, O, O], VA, VU, 4, up(0.012, 0.012, 0.01), 1, -2),
        p("walkway_tee", Walkway, [D, D, D, O], VA, VU, 4, up(0.005, 0.005, 0.005), 1, -2),
        p("walkway_cross", Walkway, [D; 4], VA, VU, 1, up(0.002, 0.002, 0.002), 1, -2),
        // arches
        p("gateway", Gateway, [GW, R, GW, R], VM, VR, 2, [0.1, 0.05, 0.0, 0.0], 0, 1),
        p("arch_bridge", ArchBridge, [AB, O, AB, O], VS, VU, 2, up(0.12, 0.12, 0.08), 1, -3),
        // pitched roofs and caps
        p("gable_ridge", GableRidge, [G, O, G, O], VA2, VR, 2, up(0.9, 0.7, 0.5), 1, -1),
        p("gable_end", GableEnd, [G, O, O, O], VA2, VR, 4, up(0.7, 0.6, 0.4), 1, -1),
        p("hip_roof", Hip, [O; 4], VA2, VR, 1, up(0.25, 0.25, 0.25), 1, -1),
        p("dome", Dome, [O; 4], VA2, VR, 1, up(0.06, 0.12, 0.2), 1, -1),
        p("spire", Spire, [O; 4], VA2, VR, 1, up(0.04, 0.12, 0.3), 1, -1),
        // facade parts
        p("balcony", Balcony, [O, O, WB, O], VA, VU, 4, up(0.35, 0.35, 0.25), 1, -2),
        // canals (layer 0)
        p("canal", Canal, [WA, R, WA, R], VA, VR, 2, g0(0.5), 0, 0),
        p("canal_bend", Canal, [WA, WA, R, R], VA, VR, 4, g0(0.25), 0, 0),
        p("canal_end", Canal, [WA, R, R, R], VA, VR, 4, g0(0.06), 0, 0),
        p("canal_bridge", CanalBridge, [WA, R, WA, R], VA, VR, 2, g0(0.25), 0, 0),
        p("arcade", Arcade, [R, AR, AK, AR], VM, VR, 4, g0(0.15), 0, 0),
    ]
}

/// The palette in sRGB. `palette_linear` gives the linear values.
pub const PALETTE_SRGB: [u32; 16] = [
    0x2d2b2e, // 0 road setts
    0x9d9386, // 1 paving stone
    0xc69b6a, // 2 sandstone
    0xe2d1ad, // 3 lime plaster
    0x8f3c2b, // 4 brick
    0xb4532d, // 5 terracotta
    0x404b58, // 6 slate
    0x4f9a86, // 7 verdigris copper
    0x2e5b2a, // 8 foliage
    0x60903b, // 9 grass
    0x1f5c73, // 10 canal water
    0x6b4429, // 11 timber
    0x1c2938, // 12 window glass
    0xffc45c, // 13 lamp light
    0xede6d6, // 14 trim stone
    0x1c1d21, // 15 iron
];

pub fn palette_linear() -> Vec<f32> {
    let lin = |c: u32| {
        let s = c as f32 / 255.0;
        if s <= 0.04045 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    let mut v = Vec::with_capacity(48);
    for &c in PALETTE_SRGB.iter() {
        v.push(lin((c >> 16) & 255));
        v.push(lin((c >> 8) & 255));
        v.push(lin(c & 255));
    }
    v
}

pub const C_ROAD: u8 = 0;
pub const C_PAVE: u8 = 1;
pub const C_SAND: u8 = 2;
pub const C_PLASTER: u8 = 3;
pub const C_BRICK: u8 = 4;
pub const C_TERRA: u8 = 5;
pub const C_SLATE: u8 = 6;
pub const C_COPPER: u8 = 7;
pub const C_LEAF: u8 = 8;
pub const C_GRASS: u8 = 9;
pub const C_WATER: u8 = 10;
pub const C_WOOD: u8 = 11;
pub const C_GLASS: u8 = 12;
pub const C_LAMP: u8 = 13;
pub const C_TRIM: u8 = 14;
pub const C_IRON: u8 = 15;

#[derive(Clone, Copy)]
pub struct Module {
    pub proto: u16,
    pub rot: u8,
}

/// The derived rules: modules, connector classes, support masks, layer
/// domains, weights, static geometry and boxes.
pub struct Rules {
    pub h: usize,
    pub protos: Vec<Proto>,
    pub mods: Vec<Module>,
    pub kind: Vec<Kind>,
    /// Connector of each module on each face (0..4 sides, 4 top, 5 bottom).
    pub face: Vec<[u8; 6]>,
    /// Per direction: (connector, modules with it, modules it supports).
    pub classes: Vec<Vec<(u8, Dom, Dom)>>,
    pub single_sup: Vec<[Dom; 6]>,
    pub init: Vec<Dom>,
    pub init_sup: Vec<[Dom; 6]>,
    pub init_ent: Vec<f32>,
    pub wt: Vec<Vec<f32>>,
    pub wlw: Vec<Vec<f32>>,
    pub geom: Vec<Vec<f32>>,
    pub boxes: Vec<Vec<[f32; 6]>>,
}

pub const OPP: [usize; 6] = [2, 3, 0, 1, 5, 4];
pub const DX: [i32; 6] = [1, 0, -1, 0, 0, 0];
pub const DY: [i32; 6] = [0, 0, 0, 0, 1, -1];
pub const DZ: [i32; 6] = [0, 1, 0, -1, 0, 0];

#[inline]
pub fn dom_set(d: &mut Dom, m: usize) {
    d[m >> 6] |= 1u64 << (m & 63);
}
#[inline]
pub fn dom_has(d: &Dom, m: usize) -> bool {
    d[m >> 6] & (1u64 << (m & 63)) != 0
}
#[inline]
pub fn dom_clear(d: &mut Dom, m: usize) {
    d[m >> 6] &= !(1u64 << (m & 63));
}
#[inline]
pub fn dom_and(a: &Dom, b: &Dom) -> Dom {
    let mut r = ZERO;
    for i in 0..W {
        r[i] = a[i] & b[i];
    }
    r
}
#[inline]
pub fn dom_meets(a: &Dom, b: &Dom) -> bool {
    (0..W).any(|i| a[i] & b[i] != 0)
}
#[inline]
pub fn dom_zero(a: &Dom) -> bool {
    a.iter().all(|&x| x == 0)
}
#[inline]
pub fn dom_count(a: &Dom) -> u32 {
    a.iter().map(|x| x.count_ones()).sum()
}
#[inline]
pub fn dom_first(a: &Dom) -> usize {
    for i in 0..W {
        if a[i] != 0 {
            return i * 64 + a[i].trailing_zeros() as usize;
        }
    }
    usize::MAX
}
pub fn dom_iter(a: &Dom) -> impl Iterator<Item = usize> + '_ {
    (0..W).flat_map(move |i| {
        let mut x = a[i];
        std::iter::from_fn(move || {
            if x == 0 {
                None
            } else {
                let t = x.trailing_zeros() as usize;
                x &= x - 1;
                Some(i * 64 + t)
            }
        })
    })
}

fn compat_dir(d: usize, a: u8, b: u8) -> bool {
    match d {
        0..=3 => h_compat(a, b),
        4 => v_compat(a, b),
        _ => v_compat(b, a),
    }
}

impl Rules {
    pub fn new(h: usize) -> Rules {
        let h = h.clamp(4, 32);
        let protos = protos();
        let mut mods = Vec::new();
        for (pi, pr) in protos.iter().enumerate() {
            for r in 0..pr.rots {
                mods.push(Module { proto: pi as u16, rot: r });
            }
        }
        let n = mods.len();
        assert!(n <= W * 64, "too many modules");
        let kind: Vec<Kind> = mods.iter().map(|m| protos[m.proto as usize].kind).collect();
        let face: Vec<[u8; 6]> = mods
            .iter()
            .map(|m| {
                let pr = &protos[m.proto as usize];
                let mut f = [0u8; 6];
                for d in 0..4 {
                    f[d] = pr.sides[(d + 4 - m.rot as usize) % 4];
                }
                f[4] = if pr.top == VT { VT + m.rot } else { pr.top };
                f[5] = if pr.bottom == VT { VT + m.rot } else { pr.bottom };
                f
            })
            .collect();
        // connector classes per direction
        let mut classes = Vec::new();
        for d in 0..6 {
            let mut list: Vec<(u8, Dom, Dom)> = Vec::new();
            for c in 0..24u8 {
                let mut has = ZERO;
                let mut sup = ZERO;
                for m in 0..n {
                    if face[m][d] == c {
                        dom_set(&mut has, m);
                    }
                    if compat_dir(d, c, face[m][OPP[d]]) {
                        dom_set(&mut sup, m);
                    }
                }
                if !dom_zero(&has) {
                    list.push((c, has, sup));
                }
            }
            classes.push(list);
        }
        let mut single_sup = vec![[ZERO; 6]; n];
        for m in 0..n {
            for d in 0..6 {
                for m2 in 0..n {
                    if compat_dir(d, face[m][d], face[m2][OPP[d]]) {
                        dom_set(&mut single_sup[m][d], m2);
                    }
                }
            }
        }
        // weights per layer
        let mut wt = vec![vec![0.0f32; n]; h];
        let mut wlw = vec![vec![0.0f32; n]; h];
        for j in 0..h {
            for m in 0..n {
                let pr = &protos[mods[m].proto as usize];
                let hi = if pr.hi < 0 { h as i32 + pr.hi } else { pr.hi };
                let ok = (j as i32) >= pr.lo && (j as i32) <= hi;
                let scale = if pr.kind == Kind::Mass && j > 0 { TOWER_START } else { 1.0 };
                let w = if ok { scale * pr.w[band(j)] / pr.rots as f32 } else { 0.0 };
                wt[j][m] = w;
                wlw[j][m] = if w > 0.0 { w * w.ln() } else { 0.0 };
            }
        }
        let mut rules = Rules {
            h,
            protos,
            mods,
            kind,
            face,
            classes,
            single_sup,
            init: Vec::new(),
            init_sup: Vec::new(),
            init_ent: Vec::new(),
            wt,
            wlw,
            geom: Vec::new(),
            boxes: Vec::new(),
        };
        // layer domains, then arc consistency on one column
        let mut init = vec![ZERO; h];
        for j in 0..h {
            for m in 0..n {
                let f = rules.face[m];
                if rules.wt[j][m] <= 0.0 {
                    continue;
                }
                if j == 0 && !v_compat(VE, f[5]) {
                    continue;
                }
                if j == h - 1 && !(f[4] == VA || f[4] == VA2) {
                    continue;
                }
                dom_set(&mut init[j], m);
            }
        }
        loop {
            let mut changed = false;
            for j in 0..h {
                let mut d = init[j];
                for hd in 0..4 {
                    d = dom_and(&d, &rules.support(&init[j], hd));
                }
                if j > 0 {
                    d = dom_and(&d, &rules.support(&init[j - 1], 4));
                }
                if j + 1 < h {
                    d = dom_and(&d, &rules.support(&init[j + 1], 5));
                }
                if d != init[j] {
                    init[j] = d;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for j in 0..h {
            assert!(!dom_zero(&init[j]), "empty layer domain at {}", j);
        }
        rules.init_sup = (0..h).map(|j| {
            let mut s = [ZERO; 6];
            for d in 0..6 {
                s[d] = rules.support(&init[j], d);
            }
            s
        }).collect();
        rules.init_ent = (0..h).map(|j| rules.entropy(&init[j], j)).collect();
        rules.init = init;
        // static geometry and boxes
        for m in 0..n {
            let md = rules.mods[m];
            let pr = &rules.protos[md.proto as usize];
            let mut v = Vec::new();
            {
                let mut b = B { v: &mut v, rot: md.rot, off: [0.0; 3], birth: 0.0 };
                build_static(pr, &mut b);
            }
            rules.geom.push(v);
            rules.boxes.push(static_boxes(pr).into_iter().map(|bx| rot_box(bx, md.rot)).collect());
        }
        rules
    }

    pub fn n(&self) -> usize {
        self.mods.len()
    }

    /// The modules that a slot with domain `dom` allows in direction `d`.
    #[inline]
    pub fn support(&self, dom: &Dom, d: usize) -> Dom {
        if dom_count(dom) == 1 {
            return self.single_sup[dom_first(dom)][d];
        }
        let mut s = ZERO;
        for (_, has, sup) in &self.classes[d] {
            if dom_meets(dom, has) {
                for i in 0..W {
                    s[i] |= sup[i];
                }
            }
        }
        s
    }

    pub fn entropy(&self, dom: &Dom, j: usize) -> f32 {
        let mut sw = 0.0f32;
        let mut swl = 0.0f32;
        let mut c = 0;
        for m in dom_iter(dom) {
            sw += self.wt[j][m];
            swl += self.wlw[j][m];
            c += 1;
        }
        if c <= 1 || sw <= 0.0 {
            return 0.0;
        }
        sw.ln() - swl / sw
    }

    pub fn proto_of(&self, m: usize) -> &Proto {
        &self.protos[self.mods[m].proto as usize]
    }
}

// ── geometry helpers ────────────────────────────────────────────────────

/// A quad on the plane x = const.
pub fn qx(b: &mut B, x: f32, z0: f32, z1: f32, y0: f32, y1: f32, col: u8, hint: [f32; 3]) {
    b.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], col, hint);
}

/// A wall on the plane x = `x` that faces +x, for z in [0, 2] and y in
/// [v_lo, v_hi], with rectangular openings [z0, z1, y0, y1] (sorted by z,
/// no overlap). Each opening has a recess of `depth` and a fill colour.
pub fn wall_px(b: &mut B, x: f32, holes: &[[f32; 4]], fill: &[u8], wall: u8, depth: f32, v_lo: f32, v_hi: f32) {
    let mut u = 0.0f32;
    for (h, &fc) in holes.iter().zip(fill.iter()) {
        if h[0] > u {
            qx(b, x, u, h[0], v_lo, v_hi, wall, PX);
        }
        if h[2] > v_lo {
            qx(b, x, h[0], h[1], v_lo, h[2], wall, PX);
        }
        if h[3] < v_hi {
            qx(b, x, h[0], h[1], h[3], v_hi, wall, PX);
        }
        let xi = x - depth;
        // reveals
        b.quad([xi, h[2], h[0]], [x, h[2], h[0]], [x, h[3], h[0]], [xi, h[3], h[0]], wall, PZ);
        b.quad([xi, h[2], h[1]], [x, h[2], h[1]], [x, h[3], h[1]], [xi, h[3], h[1]], wall, NZ);
        b.quad([xi, h[2], h[0]], [x, h[2], h[0]], [x, h[2], h[1]], [xi, h[2], h[1]], C_TRIM, PY);
        b.quad([xi, h[3], h[0]], [x, h[3], h[0]], [x, h[3], h[1]], [xi, h[3], h[1]], wall, NY);
        qx(b, xi, h[0], h[1], h[2], h[3], fc, PX);
        u = h[1];
    }
    if u < 2.0 {
        qx(b, x, u, 2.0, v_lo, v_hi, wall, PX);
    }
}

fn stairs(b: &mut B, y0: f32, y1: f32, n: usize) {
    for s in 0..n {
        let x0 = 2.0 * s as f32 / n as f32;
        let x1 = 2.0 * (s + 1) as f32 / n as f32;
        let top = y0 + (y1 - y0) * (s + 1) as f32 / n as f32;
        let bot = if s == 0 { 0.0 } else { y0 + (y1 - y0) * s as f32 / n as f32 };
        // riser and tread
        qx(b, x0, 0.12, 1.88, bot, top, C_SAND, NX);
        b.quad([x0, top, 0.12], [x0, top, 1.88], [x1, top, 1.88], [x1, top, 0.12], C_PAVE, PY);
        // balustrade walls
        b.cuboid([x0, 0.0, 0.0], [x1, top + 0.85, 0.12], C_SAND, 2 | 4 | 8 | 16);
        b.cuboid([x0, 0.0, 1.88], [x1, top + 0.85, 2.0], C_SAND, 2 | 4 | 8 | 16);
    }
}

fn ramp(b: &mut B, y0: f32, y1: f32) {
    let hint = [-(y1 - y0) * 0.5, 1.0, 0.0];
    b.quad([0.0, y0, 0.12], [0.0, y0, 1.88], [2.0, y1, 1.88], [2.0, y1, 0.12], C_PAVE, hint);
    qx(b, 0.0, 0.12, 1.88, 0.0, y0, C_SAND, NX);
    for (z0, z1) in [(0.0f32, 0.12f32), (1.88, 2.0)] {
        let (a, c) = (y0 + 0.85, y1 + 0.85);
        b.quad([0.0, 0.0, z0], [2.0, 0.0, z0], [2.0, c, z0], [0.0, a, z0], C_SAND, NZ);
        b.quad([0.0, 0.0, z1], [2.0, 0.0, z1], [2.0, c, z1], [0.0, a, z1], C_SAND, PZ);
        b.quad([0.0, a, z0], [2.0, c, z0], [2.0, c, z1], [0.0, a, z1], C_TRIM, hint);
        qx(b, 0.0, z0, z1, 0.0, a, C_SAND, NX);
    }
}

fn deck(b: &mut B, sides: [u8; 4], lamp: bool) {
    let mut mask = 16 | 32;
    for d in 0..4 {
        if sides[d] == O {
            mask |= [1, 2, 4, 8][d];
        }
    }
    b.cuboid([0.0, -0.25, 0.0], [2.0, 0.1, 2.0], C_WOOD, mask);
    for d in 0..4 {
        if sides[d] != O {
            continue;
        }
        match d {
            0 => {
                b.railing(1.94, 0.06, 1.94, 1.94, 0.1, C_IRON);
                b.boxc([1.85, -0.45, 0.0], [2.0, -0.25, 2.0], C_IRON);
            }
            1 => {
                b.railing(0.06, 1.94, 1.94, 1.94, 0.1, C_IRON);
                b.boxc([0.0, -0.45, 1.85], [2.0, -0.25, 2.0], C_IRON);
            }
            2 => {
                b.railing(0.06, 0.06, 0.06, 1.94, 0.1, C_IRON);
                b.boxc([0.0, -0.45, 0.0], [0.15, -0.25, 2.0], C_IRON);
            }
            _ => {
                b.railing(0.06, 0.06, 1.94, 0.06, 0.1, C_IRON);
                b.boxc([0.0, -0.45, 0.0], [2.0, -0.25, 0.15], C_IRON);
            }
        }
    }
    if lamp {
        b.cuboid([0.95, 0.1, 0.02], [1.05, 2.3, 0.12], C_IRON, 15 | 16);
        b.boxc([0.85, 2.2, 0.0], [1.15, 2.42, 0.3], C_LAMP);
    }
}

fn arch_curve(cx: f32, cy: f32, r: f32, n: usize) -> Vec<(f32, f32)> {
    (0..=n)
        .map(|s| {
            let a = std::f32::consts::PI * (1.0 - s as f32 / n as f32);
            (cx + r * a.cos(), cy + r * a.sin())
        })
        .collect()
}

/// The underside and the two spandrel faces of an arch along x.
fn arch(b: &mut B, pts: &[(f32, f32)], cx: f32, cy: f32, col: u8) {
    for w in pts.windows(2) {
        let (x0, y0) = w[0];
        let (x1, y1) = w[1];
        let mid = [cx - (x0 + x1) * 0.5, cy - (y0 + y1) * 0.5, 0.0];
        b.quad([x0, y0, 0.0], [x1, y1, 0.0], [x1, y1, 2.0], [x0, y0, 2.0], col, mid);
        b.quad([x0, y0, 0.0], [x1, y1, 0.0], [x1, 2.0, 0.0], [x0, 2.0, 0.0], col, NZ);
        b.quad([x0, y0, 2.0], [x1, y1, 2.0], [x1, 2.0, 2.0], [x0, 2.0, 2.0], col, PZ);
    }
}

fn gable(b: &mut B, end_wall: bool) {
    let r = 1.2;
    b.quad([0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, r, 1.0], [0.0, r, 1.0], C_TERRA, [0.0, 1.0, -r]);
    b.quad([0.0, 0.0, 2.0], [2.0, 0.0, 2.0], [2.0, r, 1.0], [0.0, r, 1.0], C_TERRA, [0.0, 1.0, r]);
    b.boxc([0.0, -0.06, -0.06], [2.0, 0.06, 0.04], C_WOOD);
    b.boxc([0.0, -0.06, 1.96], [2.0, 0.06, 2.06], C_WOOD);
    b.boxc([0.0, r - 0.04, 0.93], [2.0, r + 0.07, 1.07], C_SLATE);
    if end_wall {
        b.tri([0.0, 0.0, 0.0], [0.0, 0.0, 2.0], [0.0, r, 1.0], C_PLASTER, NX);
        qx(b, -0.01, 0.85, 1.15, 0.35, 0.7, C_GLASS, NX);
    }
}

fn roof_slab(b: &mut B) {
    b.quad([0.0, 0.05, 0.0], [0.0, 0.05, 2.0], [2.0, 0.05, 2.0], [2.0, 0.05, 0.0], C_SLATE, PY);
}

fn tree(b: &mut B, base: f32, scale: f32) {
    let s = scale;
    b.cuboid([1.0 - 0.08 * s, base, 1.0 - 0.08 * s], [1.0 + 0.08 * s, base + 1.1 * s, 1.0 + 0.08 * s], C_WOOD, 15);
    b.blob([1.0, base + 1.6 * s, 1.0], 0.72 * s, C_LEAF);
    b.blob([0.72, base + 1.3 * s, 1.22], 0.42 * s, C_LEAF);
}

/// Water channel: a 3 x 3 grid of regions; the centre is water, a side
/// region is water when that side has the WA connector, corners are bank.
fn canal(b: &mut B, sides: [u8; 4]) {
    let e = [0.0f32, 0.35, 1.65, 2.0];
    let water = |rx: usize, rz: usize| -> bool {
        match (rx, rz) {
            (1, 1) => true,
            (2, 1) => sides[0] == WA,
            (1, 2) => sides[1] == WA,
            (0, 1) => sides[2] == WA,
            (1, 0) => sides[3] == WA,
            _ => false,
        }
    };
    for rx in 0..3 {
        for rz in 0..3 {
            let (x0, x1, z0, z1) = (e[rx], e[rx + 1], e[rz], e[rz + 1]);
            if water(rx, rz) {
                b.quad([x0, -0.35, z0], [x0, -0.35, z1], [x1, -0.35, z1], [x1, -0.35, z0], C_WATER, PY);
            } else {
                b.quad([x0, 0.1, z0], [x0, 0.1, z1], [x1, 0.1, z1], [x1, 0.1, z0], C_PAVE, PY);
                // walls toward water neighbours
                if rx < 2 && water(rx + 1, rz) {
                    qx(b, x1, z0, z1, -0.6, 0.1, C_SAND, PX);
                }
                if rx > 0 && water(rx - 1, rz) {
                    qx(b, x0, z0, z1, -0.6, 0.1, C_SAND, NX);
                }
                if rz < 2 && water(rx, rz + 1) {
                    b.quad([x0, -0.6, z1], [x1, -0.6, z1], [x1, 0.1, z1], [x0, 0.1, z1], C_SAND, PZ);
                }
                if rz > 0 && water(rx, rz - 1) {
                    b.quad([x0, -0.6, z0], [x1, -0.6, z0], [x1, 0.1, z0], [x0, 0.1, z0], C_SAND, NZ);
                }
            }
        }
    }
}

fn canal_boxes(sides: [u8; 4], out: &mut Vec<[f32; 6]>) {
    let e = [0.0f32, 0.35, 1.65, 2.0];
    for rx in 0..3 {
        for rz in 0..3 {
            let water = match (rx, rz) {
                (1, 1) => true,
                (2, 1) => sides[0] == WA,
                (1, 2) => sides[1] == WA,
                (0, 1) => sides[2] == WA,
                (1, 0) => sides[3] == WA,
                _ => false,
            };
            if !water {
                out.push([e[rx], -0.6, e[rz], e[rx + 1], 0.1, e[rz + 1]]);
            }
        }
    }
}

/// A road: setts in the middle, a raised pavement strip on each R side,
/// a corner square between two S sides, lane marks on a straight road.
fn road(b: &mut B, sides: [u8; 4]) {
    b.quad([0.0, 0.05, 0.0], [0.0, 0.05, 2.0], [2.0, 0.05, 2.0], [2.0, 0.05, 0.0], C_ROAD, PY);
    for bx in road_boxes_only(sides) {
        b.cuboid([bx[0], bx[1], bx[2]], [bx[3], bx[4], bx[5]], C_PAVE, 31);
    }
    if sides == [S, R, S, R] {
        for x in [0.25f32, 1.25] {
            b.cuboid([x, 0.05, 0.96], [x + 0.5, 0.062, 1.04], C_TRIM, 16);
        }
    }
}

fn road_boxes_only(sides: [u8; 4]) -> Vec<[f32; 6]> {
    let mut v = Vec::new();
    for d in 0..4 {
        if sides[d] == R {
            let ze = if sides[(d + 1) % 4] == R { 1.55 } else { 2.0 };
            let zs = if sides[(d + 3) % 4] == R { 0.0 } else { 0.0 };
            v.push(rot_box([1.55, 0.0, zs, 2.0, 0.15, ze], d as u8));
        } else if sides[(d + 1) % 4] != R {
            // corner square between two S sides (d and d+1)
            v.push(rot_box([1.55, 0.0, 1.55, 2.0, 0.15, 2.0], d as u8));
        }
    }
    v
}

fn road_boxes(sides: [u8; 4], out: &mut Vec<[f32; 6]>) {
    out.push([0.0, 0.0, 0.0, 2.0, 0.05, 2.0]);
    out.extend(road_boxes_only(sides));
}

/// The parts of a stair tower (rotation 0, open on -x): a flight up +x on
/// z 0.1..0.97, a landing at x 1.4..1.9, a flight up -x on z 1.03..1.9,
/// a top landing at x 0..0.6 that is the base landing of the next flight.
fn tower_parts(base: bool) -> Vec<([f32; 6], u8)> {
    let mut v = Vec::new();
    if base {
        v.push(([0.0, 0.0, 0.0, 2.0, 0.1, 2.0], C_PAVE));
    }
    let tops_a = [0.43f32, 0.76, 1.1];
    let tops_b = [1.43f32, 1.77, 2.1];
    for s in 0..3 {
        let x0 = 0.6 + 0.2667 * s as f32;
        v.push(([x0, tops_a[s] - 0.2, 0.1, x0 + 0.2667, tops_a[s], 0.97], C_TRIM));
        let x1 = 1.4 - 0.2667 * s as f32;
        v.push(([x1 - 0.2667, tops_b[s] - 0.2, 1.03, x1, tops_b[s], 1.9], C_TRIM));
    }
    v.push(([1.4, 0.9, 0.1, 1.9, 1.1, 1.9], C_PAVE));
    v.push(([0.0, 1.9, 0.1, 0.6, 2.1, 1.9], C_PAVE));
    // walls: +x, +z, -z and the lane divider
    v.push(([1.9, 0.0, 0.0, 2.0, 2.0, 2.0], C_SAND));
    v.push(([0.0, 0.0, 1.9, 1.9, 2.0, 2.0], C_SAND));
    if base {
        // a door on -z at the base landing
        v.push(([0.6, 0.0, 0.0, 1.9, 2.0, 0.1], C_SAND));
        v.push(([0.0, 1.85, 0.0, 0.6, 2.0, 0.1], C_SAND));
    } else {
        v.push(([0.0, 0.0, 0.0, 1.9, 2.0, 0.1], C_SAND));
    }
    v.push(([0.6, 0.0, 0.97, 1.4, 2.0, 1.03], C_SAND));
    v
}

fn tower(b: &mut B, base: bool) {
    for (bx, col) in tower_parts(base) {
        b.boxc([bx[0], bx[1], bx[2]], [bx[3], bx[4], bx[5]], col);
    }
    // slit windows and a top band on the outer walls
    qx(b, 2.01, 0.8, 1.2, 0.6, 1.5, C_GLASS, PX);
    b.quad([0.8, 0.6, 2.01], [1.2, 0.6, 2.01], [1.2, 1.5, 2.01], [0.8, 1.5, 2.01], C_GLASS, PZ);
    b.quad([0.8, 0.6, -0.01], [1.2, 0.6, -0.01], [1.2, 1.5, -0.01], [0.8, 1.5, -0.01], C_GLASS, NZ);
    b.cuboid([-0.02, 1.88, -0.04], [2.04, 2.0, 0.0], C_TRIM, 8 | 16 | 32);
    b.cuboid([-0.02, 1.88, 2.0], [2.04, 2.0, 2.04], C_TRIM, 2 | 16 | 32);
    b.cuboid([2.0, 1.88, 0.0], [2.04, 2.0, 2.0], C_TRIM, 1 | 16 | 32);
}

/// The head of a stair tower: low walls on +x, +z and -z, open on -x,
/// four corner posts that carry a slate cap.
fn head_parts() -> Vec<[f32; 6]> {
    vec![
        [1.9, 0.0, 0.0, 2.0, 1.1, 2.0],
        [0.6, 0.0, 1.9, 1.9, 1.1, 2.0],
        [0.6, 0.0, 0.0, 1.9, 1.1, 0.1],
        [0.0, 0.0, 0.0, 0.12, 1.9, 0.12],
        [0.0, 0.0, 1.88, 0.12, 1.9, 2.0],
        [1.88, 1.1, 0.0, 2.0, 1.9, 0.12],
        [1.88, 1.1, 1.88, 2.0, 1.9, 2.0],
    ]
}

fn tower_boxes(base: bool, out: &mut Vec<[f32; 6]>) {
    for (bx, _) in tower_parts(base) {
        out.push(bx);
    }
}

/// The geometry of a prototype at rotation 0 (the builder turns it).
/// Floor slabs, facades and parapets come from the mesher (context).
pub fn build_static(pr: &Proto, b: &mut B) {
    use Kind::*;
    match pr.kind {
        Air | Mass | Street | Plaza | Lawn | Roof | Landing => {}
        Garden => {
            b.blob([0.6, 0.55, 0.6], 0.3, C_LEAF);
            b.blob([1.4, 0.6, 1.3], 0.36, C_LEAF);
            b.blob([1.35, 0.5, 0.5], 0.22, C_LEAF);
        }
        Tree => tree(b, 0.3, 1.0),
        RoofTree => tree(b, 0.3, 0.75),
        Lamp => {
            b.cuboid([0.25, 0.1, 0.25], [0.35, 2.5, 0.35], C_IRON, 15 | 16);
            b.boxc([0.3, 2.4, 0.27], [0.85, 2.46, 0.33], C_IRON);
            b.boxc([0.72, 2.18, 0.2], [0.92, 2.4, 0.4], C_LAMP);
        }
        Bench => {
            b.boxc([0.3, 0.42, 0.4], [0.7, 0.5, 1.6], C_WOOD);
            b.boxc([0.3, 0.5, 0.4], [0.36, 0.9, 1.6], C_WOOD);
            b.cuboid([0.35, 0.1, 0.45], [0.65, 0.42, 0.52], C_IRON, 15);
            b.cuboid([0.35, 0.1, 1.48], [0.65, 0.42, 1.55], C_IRON, 15);
        }
        Fountain => {
            let n = 8;
            b.prism(1.0, 1.0, 0.85, 0.1, 0.55, n, C_SAND, false);
            for s in 0..n {
                let a0 = s as f32 / n as f32 * std::f32::consts::TAU;
                let a1 = (s + 1) as f32 / n as f32 * std::f32::consts::TAU;
                let (c0, s0, c1, s1) = (a0.cos(), a0.sin(), a1.cos(), a1.sin());
                b.quad(
                    [1.0 + 0.72 * c0, 0.55, 1.0 + 0.72 * s0],
                    [1.0 + 0.85 * c0, 0.55, 1.0 + 0.85 * s0],
                    [1.0 + 0.85 * c1, 0.55, 1.0 + 0.85 * s1],
                    [1.0 + 0.72 * c1, 0.55, 1.0 + 0.72 * s1],
                    C_TRIM,
                    PY,
                );
                b.tri([1.0, 0.45, 1.0], [1.0 + 0.72 * c0, 0.45, 1.0 + 0.72 * s0], [1.0 + 0.72 * c1, 0.45, 1.0 + 0.72 * s1], C_WATER, PY);
            }
            b.prism(1.0, 1.0, 0.1, 0.45, 1.2, 6, C_TRIM, true);
            b.prism(1.0, 1.0, 0.32, 1.2, 1.3, 8, C_SAND, true);
        }
        Stall => {
            b.boxc([0.3, 0.1, 0.3], [1.7, 0.9, 0.8], C_WOOD);
            for (x, z) in [(0.3, 0.3), (1.7, 0.3), (0.3, 1.7), (1.7, 1.7)] {
                b.cuboid([x - 0.04, 0.1, z - 0.04], [x + 0.04, 1.9, z + 0.04], C_IRON, 15);
            }
            for s in 0..4 {
                let x0 = 0.2 + 0.4 * s as f32;
                let col = if s % 2 == 0 { C_TERRA } else { C_TRIM };
                b.boxc([x0, 1.9, 0.2], [x0 + 0.4, 2.0, 1.8], col);
            }
        }
        Planter => {
            b.cuboid([0.3, 0.1, 0.3], [1.7, 0.6, 1.7], C_SAND, 15);
            b.quad([0.3, 0.6, 0.3], [0.3, 0.6, 1.7], [1.7, 0.6, 1.7], [1.7, 0.6, 0.3], C_GRASS, PY);
            b.blob([0.75, 0.9, 0.75], 0.35, C_LEAF);
            b.blob([1.3, 0.95, 1.2], 0.4, C_LEAF);
        }
        Bollards => {
            for z in [0.4f32, 1.0, 1.6] {
                b.prism(1.0, z, 0.08, 0.1, 0.8, 6, C_IRON, true);
            }
        }
        Chimney => {
            b.cuboid([0.3, 0.1, 0.3], [0.8, 1.6, 0.8], C_BRICK, 15);
            b.boxc([0.25, 1.6, 0.25], [0.85, 1.7, 0.85], C_SLATE);
            b.cuboid([1.3, 0.1, 1.2], [1.6, 0.9, 1.5], C_BRICK, 15 | 16);
        }
        Tank => {
            for (x, z) in [(0.6, 0.6), (1.4, 0.6), (0.6, 1.4), (1.4, 1.4)] {
                b.cuboid([x - 0.05, 0.1, z - 0.05], [x + 0.05, 0.9, z + 0.05], C_WOOD, 15);
            }
            b.cuboid([0.5, 0.85, 0.5], [1.5, 0.9, 1.5], C_WOOD, 31 | 32);
            b.prism(1.0, 1.0, 0.6, 0.9, 1.9, 8, C_WOOD, false);
            b.prism(1.0, 1.0, 0.63, 1.2, 1.26, 8, C_IRON, false);
            b.prism(1.0, 1.0, 0.63, 1.6, 1.66, 8, C_IRON, false);
            b.cone(1.0, 1.0, 0.66, 1.9, 2.35, 8, C_SLATE, 0.0);
        }
        Skylight => {
            b.cuboid([0.4, 0.1, 0.4], [1.6, 0.3, 1.6], C_TRIM, 31);
            b.cone(1.0, 1.0, 0.85, 0.3, 0.8, 4, C_GLASS, 0.5);
        }
        Mast => {
            b.cuboid([0.8, 0.1, 0.8], [1.2, 0.3, 1.2], C_SLATE, 31);
            b.cuboid([0.96, 0.3, 0.96], [1.04, 3.2, 1.04], C_IRON, 15);
            b.boxc([0.7, 1.5, 0.97], [1.3, 1.55, 1.03], C_IRON);
            b.boxc([0.97, 2.4, 0.75], [1.03, 2.45, 1.25], C_IRON);
            b.boxc([0.93, 3.2, 0.93], [1.07, 3.32, 1.07], C_LAMP);
        }
        Solar => {
            for x in [0.25f32, 1.1] {
                b.quad([x, 0.3, 0.25], [x, 0.3, 1.75], [x + 0.6, 0.65, 1.75], [x + 0.6, 0.65, 0.25], C_GLASS, [-0.35, 0.6, 0.0]);
                b.quad([x, 0.28, 0.25], [x, 0.28, 1.75], [x + 0.6, 0.63, 1.75], [x + 0.6, 0.63, 0.25], C_IRON, [0.35, -0.6, 0.0]);
                b.cuboid([x + 0.55, 0.1, 0.3], [x + 0.6, 0.63, 0.35], C_IRON, 15);
                b.cuboid([x + 0.55, 0.1, 1.65], [x + 0.6, 0.63, 1.7], C_IRON, 15);
            }
        }
        Parasol => {
            b.prism(1.0, 1.0, 0.38, 0.7, 0.76, 8, C_WOOD, true);
            b.cuboid([0.97, 0.1, 0.97], [1.03, 1.95, 1.03], C_IRON, 15);
            b.cone(1.0, 1.0, 0.95, 1.6, 2.0, 8, C_TERRA, 0.0);
            for s in 0..8 {
                let a0 = s as f32 / 8.0 * std::f32::consts::TAU;
                let a1 = (s + 1) as f32 / 8.0 * std::f32::consts::TAU;
                b.tri([1.0, 1.6, 1.0], [1.0 + 0.95 * a0.cos(), 1.6, 1.0 + 0.95 * a0.sin()], [1.0 + 0.95 * a1.cos(), 1.6, 1.0 + 0.95 * a1.sin()], C_TRIM, NY);
            }
            b.boxc([0.3, 0.1, 0.8], [0.6, 0.5, 1.2], C_WOOD);
            b.boxc([1.4, 0.1, 0.8], [1.7, 0.5, 1.2], C_WOOD);
        }
        Pergola => {
            for (x, z) in [(0.2, 0.2), (1.8, 0.2), (0.2, 1.8), (1.8, 1.8)] {
                b.cuboid([x - 0.06, 0.1, z - 0.06], [x + 0.06, 1.9, z + 0.06], C_WOOD, 15);
            }
            b.boxc([0.1, 1.9, 0.14], [1.9, 2.0, 0.26], C_WOOD);
            b.boxc([0.1, 1.9, 1.74], [1.9, 2.0, 1.86], C_WOOD);
            for s in 0..5 {
                let x = 0.3 + 0.35 * s as f32;
                b.boxc([x - 0.03, 2.0, 0.1], [x + 0.03, 2.06, 1.9], C_WOOD);
            }
            b.blob([0.25, 1.3, 0.25], 0.35, C_LEAF);
            b.blob([1.75, 1.1, 1.75], 0.4, C_LEAF);
            b.boxc([0.6, 0.1, 0.8], [1.4, 0.45, 1.2], C_WOOD);
        }
        StairFoot => stairs(b, 0.1, 1.0, 3),
        StairTop => stairs(b, 1.0, 2.1, 3),
        StairSteep => stairs(b, 0.1, 2.1, 5),
        RampFoot => ramp(b, 0.1, 1.0),
        RampTop => ramp(b, 1.0, 2.1),
        Walkway => deck(b, pr.sides, false),
        WalkwayLamp => deck(b, pr.sides, true),
        Gateway => {
            b.quad([0.3, 0.1, 0.0], [0.3, 0.1, 2.0], [1.7, 0.1, 2.0], [1.7, 0.1, 0.0], C_PAVE, PY);
            b.cuboid([0.0, 0.0, 0.0], [0.3, 2.0, 2.0], C_SAND, 1 | 2 | 8);
            b.cuboid([1.7, 0.0, 0.0], [2.0, 2.0, 2.0], C_SAND, 4 | 2 | 8);
            let pts = arch_curve(1.0, 1.2, 0.7, 8);
            arch(b, &pts, 1.0, 1.2, C_SAND);
            b.boxc([0.88, 1.82, -0.05], [1.12, 2.0, 2.05], C_TRIM);
            b.boxc([-0.02, 1.15, -0.05], [0.32, 1.25, 2.05], C_TRIM);
            b.boxc([1.68, 1.15, -0.05], [2.02, 1.25, 2.05], C_TRIM);
        }
        ArchBridge => {
            let pts = arch_curve(1.0, 0.0, 1.0, 10);
            arch(b, &pts, 1.0, 0.0, C_SAND);
            b.boxc([0.0, 1.8, -0.06], [2.0, 1.95, 0.0], C_TRIM);
            b.boxc([0.0, 1.8, 2.0], [2.0, 1.95, 2.06], C_TRIM);
            b.boxc([0.88, 0.9, -0.05], [1.12, 1.2, 2.05], C_TRIM);
        }
        GableRidge => gable(b, false),
        GableEnd => gable(b, true),
        Hip => {
            let c = [1.0, 0.0, 1.0];
            let a = [1.0, 1.1, 1.0];
            let q = [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 0.0, 2.0], [0.0, 0.0, 2.0]];
            for s in 0..4 {
                b.tri_out(q[s], q[(s + 1) % 4], a, C_SLATE, c);
            }
            b.boxc([0.95, 1.05, 0.95], [1.05, 1.35, 1.05], C_IRON);
        }
        Dome => {
            roof_slab(b);
            b.prism(1.0, 1.0, 0.85, 0.0, 0.5, 8, C_PLASTER, false);
            let rings = [(0.5f32, 0.85f32), (0.88, 0.72), (1.12, 0.46), (1.24, 0.18)];
            let c = [1.0, 0.5, 1.0];
            for w in rings.windows(2) {
                let (y0, r0) = w[0];
                let (y1, r1) = w[1];
                for s in 0..8 {
                    let a0 = s as f32 / 8.0 * std::f32::consts::TAU;
                    let a1 = (s + 1) as f32 / 8.0 * std::f32::consts::TAU;
                    let p0 = [1.0 + r0 * a0.cos(), y0, 1.0 + r0 * a0.sin()];
                    let p1 = [1.0 + r0 * a1.cos(), y0, 1.0 + r0 * a1.sin()];
                    let p2 = [1.0 + r1 * a1.cos(), y1, 1.0 + r1 * a1.sin()];
                    let p3 = [1.0 + r1 * a0.cos(), y1, 1.0 + r1 * a0.sin()];
                    b.tri_out(p0, p1, p2, C_COPPER, c);
                    b.tri_out(p0, p2, p3, C_COPPER, c);
                }
            }
            b.prism(1.0, 1.0, 0.18, 1.24, 1.3, 8, C_COPPER, true);
            b.prism(1.0, 1.0, 0.08, 1.3, 1.6, 6, C_TRIM, true);
        }
        Spire => {
            roof_slab(b);
            b.cuboid([0.45, 0.0, 0.45], [1.55, 0.6, 1.55], C_SAND, 15 | 16);
            b.cone(1.0, 1.0, 0.78, 0.6, 2.7, 4, C_SLATE, 0.5);
            b.boxc([0.97, 2.6, 0.97], [1.03, 2.95, 1.03], C_IRON);
        }
        Balcony => {
            b.cuboid([0.0, -0.15, 0.2], [1.0, 0.08, 1.8], C_TRIM, 1 | 2 | 8 | 16 | 32);
            b.railing(0.97, 0.23, 0.97, 1.77, 0.08, C_IRON);
            b.railing(0.03, 0.23, 0.97, 0.23, 0.08, C_IRON);
            b.railing(0.03, 1.77, 0.97, 1.77, 0.08, C_IRON);
            b.boxc([0.0, -0.45, 0.35], [0.45, -0.15, 0.45], C_SLATE);
            b.boxc([0.0, -0.45, 1.55], [0.45, -0.15, 1.65], C_SLATE);
        }
        Canal => canal(b, pr.sides),
        Road => road(b, pr.sides),
        RoadGate => {
            b.quad([0.3, 0.05, 0.0], [0.3, 0.05, 2.0], [1.7, 0.05, 2.0], [1.7, 0.05, 0.0], C_ROAD, PY);
            b.cuboid([0.0, 0.0, 0.0], [0.3, 2.0, 2.0], C_SAND, 1 | 2 | 8);
            b.cuboid([1.7, 0.0, 0.0], [2.0, 2.0, 2.0], C_SAND, 4 | 2 | 8);
            let pts = arch_curve(1.0, 1.25, 0.7, 8);
            arch(b, &pts, 1.0, 1.25, C_SAND);
            b.boxc([0.88, 1.84, -0.05], [1.12, 2.0, 2.05], C_TRIM);
            b.boxc([0.4, 1.6, 0.4], [0.5, 1.75, 1.6], C_LAMP);
        }
        RoadBridge => {
            canal(b, pr.sides);
            b.cuboid([0.25, -0.15, 0.0], [1.75, 0.05, 2.0], C_ROAD, 1 | 4 | 16 | 32);
            b.boxc([0.25, 0.05, 0.0], [0.4, 0.65, 2.0], C_TRIM);
            b.boxc([1.6, 0.05, 0.0], [1.75, 0.65, 2.0], C_TRIM);
            b.boxc([0.85, -0.6, 0.7], [1.15, -0.15, 1.3], C_SAND);
        }
        TowerBase => tower(b, true),
        TowerFlight => tower(b, false),
        TowerHead => {
            for bx in head_parts() {
                b.boxc([bx[0], bx[1], bx[2]], [bx[3], bx[4], bx[5]], C_SAND);
            }
            b.boxc([-0.05, 1.9, -0.05], [2.05, 2.05, 2.05], C_SLATE);
            b.cone(1.0, 1.0, 1.3, 2.05, 2.7, 4, C_SLATE, 0.5);
        }
        CanalBridge => {
            canal(b, pr.sides);
            b.boxc([0.65, 0.1, 0.3], [1.35, 0.3, 1.7], C_SAND);
            b.boxc([0.65, 0.3, 0.3], [0.72, 0.75, 1.7], C_TRIM);
            b.boxc([1.28, 0.3, 0.3], [1.35, 0.75, 1.7], C_TRIM);
            b.boxc([0.75, -0.6, 0.85], [1.25, 0.1, 1.15], C_SAND);
        }
        Arcade => {
            b.quad([0.15, 0.1, 0.0], [0.15, 0.1, 2.0], [2.0, 0.1, 2.0], [2.0, 0.1, 0.0], C_PAVE, PY);
            wall_px(b, 0.15, &[[0.25, 0.95, 0.1, 1.5], [1.15, 1.75, 0.45, 1.5]], &[C_WOOD, C_GLASS], C_PLASTER, 0.08, 0.0, 1.8);
            b.cuboid([0.15, 1.8, 0.0], [2.0, 2.0, 2.0], C_SAND, 1 | 32);
            b.cuboid([1.72, 0.0, 0.0], [1.98, 1.8, 0.13], C_TRIM, 1 | 4 | 2);
            b.cuboid([1.72, 0.0, 1.87], [1.98, 1.8, 2.0], C_TRIM, 1 | 4 | 8);
            b.boxc([1.7, 1.6, 0.0], [2.0, 1.8, 2.0], C_TRIM);
        }
    }
}

/// The collision boxes of a prototype at rotation 0, as
/// [x0, y0, z0, x1, y1, z1] in the cell frame.
pub fn static_boxes(pr: &Proto) -> Vec<[f32; 6]> {
    use Kind::*;
    let mut v: Vec<[f32; 6]> = Vec::new();
    if let Some((h, _)) = pr.kind.floor() {
        v.push([0.0, 0.0, 0.0, 2.0, h, 2.0]);
    }
    let stair_boxes = |v: &mut Vec<[f32; 6]>, y0: f32, y1: f32, n: usize| {
        for s in 0..n {
            let x0 = 2.0 * s as f32 / n as f32;
            let x1 = 2.0 * (s + 1) as f32 / n as f32;
            let top = y0 + (y1 - y0) * (s + 1) as f32 / n as f32;
            v.push([x0, 0.0, 0.0, x1, top, 2.0]);
            v.push([x0, top, 0.0, x1, top + 0.85, 0.12]);
            v.push([x0, top, 1.88, x1, top + 0.85, 2.0]);
        }
    };
    match pr.kind {
        Mass => v.push([0.0, 0.0, 0.0, 2.0, 2.0, 2.0]),
        Tree | RoofTree => v.push([0.88, 0.0, 0.88, 1.12, 1.4, 1.12]),
        Lamp => v.push([0.2, 0.0, 0.2, 0.4, 2.5, 0.4]),
        Bench => v.push([0.3, 0.0, 0.4, 0.7, 0.55, 1.6]),
        Fountain => v.push([0.15, 0.0, 0.15, 1.85, 0.55, 1.85]),
        Stall => v.push([0.3, 0.0, 0.3, 1.7, 0.9, 0.8]),
        Planter => v.push([0.3, 0.0, 0.3, 1.7, 0.6, 1.7]),
        Bollards => v.push([0.92, 0.0, 0.32, 1.08, 0.8, 1.68]),
        Chimney => {
            v.push([0.3, 0.0, 0.3, 0.8, 1.7, 0.8]);
            v.push([1.3, 0.0, 1.2, 1.6, 0.9, 1.5]);
        }
        Tank => v.push([0.45, 0.0, 0.45, 1.55, 2.0, 1.55]),
        Skylight => v.push([0.4, 0.0, 0.4, 1.6, 0.6, 1.6]),
        Mast => v.push([0.8, 0.0, 0.8, 1.2, 3.2, 1.2]),
        Solar => v.push([0.2, 0.0, 0.25, 1.8, 0.62, 1.75]),
        Parasol => v.push([0.6, 0.0, 0.6, 1.4, 0.76, 1.4]),
        Pergola => {
            for (x, z) in [(0.2f32, 0.2f32), (1.8, 0.2), (0.2, 1.8), (1.8, 1.8)] {
                v.push([x - 0.06, 0.0, z - 0.06, x + 0.06, 2.0, z + 0.06]);
            }
            v.push([0.6, 0.0, 0.8, 1.4, 0.45, 1.2]);
        }
        StairFoot => stair_boxes(&mut v, 0.1, 1.0, 3),
        StairTop => stair_boxes(&mut v, 1.0, 2.1, 3),
        StairSteep => stair_boxes(&mut v, 0.1, 2.1, 5),
        RampFoot => stair_boxes(&mut v, 0.1, 1.0, 6),
        RampTop => stair_boxes(&mut v, 1.0, 2.1, 6),
        Walkway | WalkwayLamp => {
            v.push([0.0, -0.25, 0.0, 2.0, 0.1, 2.0]);
            for d in 0..4 {
                if pr.sides[d] != O {
                    continue;
                }
                v.push(match d {
                    0 => [1.9, 0.1, 0.0, 2.0, 1.1, 2.0],
                    1 => [0.0, 0.1, 1.9, 2.0, 1.1, 2.0],
                    2 => [0.0, 0.1, 0.0, 0.1, 1.1, 2.0],
                    _ => [0.0, 0.1, 0.0, 2.0, 1.1, 0.1],
                });
            }
        }
        Gateway => {
            v.push([0.3, 0.0, 0.0, 1.7, 0.1, 2.0]);
            v.push([0.0, 0.0, 0.0, 0.3, 2.0, 2.0]);
            v.push([1.7, 0.0, 0.0, 2.0, 2.0, 2.0]);
            v.push([0.3, 1.75, 0.0, 1.7, 2.0, 2.0]);
        }
        ArchBridge => {
            v.push([0.0, 0.0, 0.0, 0.4, 2.0, 2.0]);
            v.push([1.6, 0.0, 0.0, 2.0, 2.0, 2.0]);
            v.push([0.4, 0.9, 0.0, 1.6, 2.0, 2.0]);
        }
        GableRidge | GableEnd => {
            v.push([0.0, 0.0, 0.0, 2.0, 0.45, 2.0]);
            v.push([0.0, 0.45, 0.4, 2.0, 0.9, 1.6]);
        }
        Hip | Dome | Spire => {
            v.push([0.0, 0.0, 0.0, 2.0, 0.1, 2.0]);
            v.push([0.4, 0.0, 0.4, 1.6, 1.0, 1.6]);
        }
        Balcony => {
            v.push([0.0, -0.15, 0.2, 1.0, 0.08, 1.8]);
            v.push([0.92, 0.08, 0.2, 1.0, 1.1, 1.8]);
            v.push([0.0, 0.08, 0.2, 1.0, 1.1, 0.28]);
            v.push([0.0, 0.08, 1.72, 1.0, 1.1, 1.8]);
        }
        Canal => canal_boxes(pr.sides, &mut v),
        Road => road_boxes(pr.sides, &mut v),
        RoadGate => {
            v.push([0.0, 0.0, 0.0, 2.0, 0.05, 2.0]);
            v.push([0.0, 0.0, 0.0, 0.3, 2.0, 2.0]);
            v.push([1.7, 0.0, 0.0, 2.0, 2.0, 2.0]);
            v.push([0.3, 1.8, 0.0, 1.7, 2.0, 2.0]);
        }
        RoadBridge => {
            canal_boxes(pr.sides, &mut v);
            v.push([0.25, -0.6, 0.0, 1.75, 0.05, 2.0]);
            v.push([0.25, 0.05, 0.0, 0.4, 0.65, 2.0]);
            v.push([1.6, 0.05, 0.0, 1.75, 0.65, 2.0]);
        }
        TowerBase | TowerFlight => tower_boxes(pr.kind == TowerBase, &mut v),
        TowerHead => {
            v.extend(head_parts());
            v.push([-0.05, 1.9, -0.05, 2.05, 2.05, 2.05]);
        }
        CanalBridge => {
            canal_boxes(pr.sides, &mut v);
            v.push([0.65, -0.6, 0.3, 1.35, 0.3, 1.7]);
            v.push([0.65, 0.3, 0.3, 0.72, 0.75, 1.7]);
            v.push([1.28, 0.3, 0.3, 1.35, 0.75, 1.7]);
        }
        Arcade => {
            v.push([0.0, 0.0, 0.0, 2.0, 0.1, 2.0]);
            v.push([0.0, 0.0, 0.0, 0.15, 2.0, 2.0]);
            v.push([0.15, 1.8, 0.0, 2.0, 2.0, 2.0]);
            v.push([1.72, 0.0, 0.0, 1.98, 1.8, 0.13]);
            v.push([1.72, 0.0, 1.87, 1.98, 1.8, 2.0]);
        }
        _ => {}
    }
    v
}
