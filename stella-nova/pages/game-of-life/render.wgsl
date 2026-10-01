// render.wgsl - draw the world into the canvas.
//
// One full-screen triangle. Each pixel finds the cell under it:
//   cell x = cx + (pixel x - vw / 2 - ox) / cell
// (the same for y). cell is device px per cell. ox, oy move the view center
// off the canvas center, so the world centers in the part that the panels
// leave clear. A pixel reads one cell when a cell is 1 px or larger, so the
// cells stay crisp at any zoom. When a cell is smaller than 1 px, the pixel
// takes the mean colour of up to 4 x 4 cells, so a zoomed-out soup does not
// flicker.
//
// cell_colour() must stay the same as cellColour() in engine-cpu.js.

struct View {
  vw: f32, vh: f32, cx: f32, cy: f32,
  cell: f32, ox: f32, oy: f32, W: f32,
  H: f32, mode: u32, trails: u32, grid: u32,
  trail: f32, pad0: f32, pad1: f32, pad2: f32,
};

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> state: array<u32>;

const BG = vec3<f32>(0.027, 0.035, 0.051);
const OUTSIDE = vec3<f32>(0.012, 0.014, 0.020);
const PLAIN = vec3<f32>(0.914, 0.937, 0.902);
const NEWBORN = vec3<f32>(1.0, 0.84, 0.43);
const YOUNG = vec3<f32>(0.72, 0.94, 0.48);
const MATURE = vec3<f32>(0.27, 0.82, 0.69);
const OLD = vec3<f32>(0.29, 0.53, 0.91);
const GHOST = vec3<f32>(0.76, 0.29, 0.43);

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn cell_colour(v: u32) -> vec3<f32> {
  let age = v & 0xFFu;
  if (age != 0u) {
    if (V.mode == 0u) { return PLAIN; }
    if (age == 1u) { return NEWBORN; }
    let f = clamp(log2(f32(age - 1u)) / 6.0, 0.0, 1.0);
    if (f < 0.5) { return mix(YOUNG, MATURE, f * 2.0); }
    return mix(MATURE, OLD, f * 2.0 - 1.0);
  }
  let t = f32((v >> 8u) & 0xFFu);
  if (V.trails == 0u || t <= 0.0) { return BG; }
  let k = t / V.trail;
  return mix(BG, GHOST, 0.36 * k * k);
}

fn cell_at(x: f32, y: f32) -> u32 {
  let ix = u32(clamp(x, 0.0, V.W - 1.0));
  let iy = u32(clamp(y, 0.0, V.H - 1.0));
  return state[iy * u32(V.W) + ix];
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let wx = V.cx + (pos.x - V.vw * 0.5 - V.ox) / V.cell;
  let wy = V.cy + (pos.y - V.vh * 0.5 - V.oy) / V.cell;
  let px = 1.0 / V.cell;              // one pixel in cells
  if (wx < 0.0 || wy < 0.0 || wx >= V.W || wy >= V.H) {
    // A thin line marks the edge of the world.
    let ex = max(-wx, wx - V.W);
    let ey = max(-wy, wy - V.H);
    if (max(ex, ey) < 1.5 * px) { return vec4<f32>(0.20, 0.24, 0.30, 1.0); }
    return vec4<f32>(OUTSIDE, 1.0);
  }
  var c: vec3<f32>;
  if (V.cell >= 1.0) {
    c = cell_colour(cell_at(wx, wy));
  } else {
    let k = min(4u, u32(ceil(px)));
    let x0 = floor(wx);
    let y0 = floor(wy);
    var acc = vec3<f32>(0.0);
    for (var j = 0u; j < k; j++) {
      for (var i = 0u; i < k; i++) {
        let sx = x0 + (f32(i) + 0.5) * px / f32(k);
        let sy = y0 + (f32(j) + 0.5) * px / f32(k);
        acc += cell_colour(cell_at(sx, sy));
      }
    }
    c = acc / f32(k * k);
  }
  // Grid lines when a cell is 6 px or more. Every tenth line is brighter.
  if (V.grid != 0u && V.cell >= 6.0) {
    let fx = fract(wx);
    let fy = fract(wy);
    let lx = min(fx, 1.0 - fx) * V.cell;
    let ly = min(fy, 1.0 - fy) * V.cell;
    if (min(lx, ly) < 0.5) {
      let gx = floor(wx + 0.5);
      let gy = floor(wy + 0.5);
      let major = (lx < 0.5 && (i32(gx) % 10) == 0) || (ly < 0.5 && (i32(gy) % 10) == 0);
      let a = select(0.09, 0.2, major) * clamp((V.cell - 6.0) / 6.0 + 0.5, 0.0, 1.0);
      c = mix(c, vec3<f32>(0.55, 0.62, 0.72), a);
    }
  }
  return vec4<f32>(c, 1.0);
}
