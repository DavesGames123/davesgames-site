// grid.wgsl — draws the MarkovJunior grid, one full-screen triangle per view.
//
// render.js packs one texel per cell into cells (rgba32uint):
//   r  state | writer << 8 | min(matches, 65535) << 16
//   g  stamp: interpreter turn of the last write, 0 = never written
//   b  heat: number of writes
//   a  potential + 1, 0 = none or unreachable
// V.mode.x picks the pass. U holds the grid size, camera and pass settings.
//
// grep: PASS_  fn cellAt  fn fs  fn turbo

struct U {
  grid : vec4f,   // x MX, y MY, z C, w current turn
  cam  : vec4f,   // x zoom multiplier, y pan x (cells), z pan y (cells), w grid lines on
  viz  : vec4f,   // x trail (turns), y heat max, z isolate value (-1 none), w potential max
  viz2 : vec4f,   // x leaf count, y match max, z highlight leaf id (0 none), w unused
  pal  : array<vec4f, 32>,
};
struct View { rect: vec4f, mode: vec4f };   // rect px x y w h; mode x pass

@group(0) @binding(0) var<uniform> P : U;
@group(0) @binding(1) var cells : texture_2d<u32>;
@group(1) @binding(0) var<uniform> V : View;

const PASS_COLORS = 0;
const PASS_AGE = 1;
const PASS_WRITER = 2;
const PASS_HEAT = 3;
const PASS_MATCHES = 4;
const PASS_POTENTIAL = 5;
const PASS_ISOLATE = 6;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn turbo(x: f32) -> vec3f {
  let t = clamp(x, 0.0, 1.0);
  let r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  let g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  let b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return clamp(vec3f(r, g, b), vec3f(0.0), vec3f(1.0));
}

fn hue(h: f32) -> vec3f {
  return clamp(abs(fract(h + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let rect = V.rect;
  let MX = P.grid.x;
  let MY = P.grid.y;
  // Fit the grid in the view, then apply the shared zoom and pan.
  let fit = min(rect.z / MX, rect.w / MY) * 0.94;
  let cellPx = fit * P.cam.x;
  let local = fc.xy - rect.xy - rect.zw * 0.5;
  let g = local / cellPx + vec2f(MX, MY) * 0.5 + P.cam.yz;
  let bg = vec3f(0.035, 0.05, 0.08);
  if (g.x < 0.0 || g.y < 0.0 || g.x >= MX || g.y >= MY) {
    let chk = f32((u32(floor(fc.x / 12.0)) + u32(floor(fc.y / 12.0))) % 2u);
    return vec4f(bg + chk * 0.012, 1.0);
  }
  let ci = vec2i(floor(g));
  let t = textureLoad(cells, ci, 0);
  let s = t.r & 0xffu;
  let writer = (t.r >> 8u) & 0xffu;
  let matches = t.r >> 16u;
  let stamp = t.g;
  let heat = t.b;
  let pot = i32(t.a) - 1;
  let base = P.pal[s].rgb;
  let turn = P.grid.w;
  let mode = i32(V.mode.x);

  var c = base;
  switch mode {
    case PASS_AGE: {
      if (stamp == 0u) { c = base * 0.18; }
      else {
        let age = (turn - f32(stamp)) / max(P.viz.x, 1.0);
        let k = exp(-age * 3.0);
        c = mix(base * 0.22, turbo(0.35 + 0.65 * k), k);
      }
    }
    case PASS_WRITER: {
      if (writer == 0u) { c = base * 0.15; }
      else {
        let h = hue(f32(writer) / max(P.viz2.x, 1.0) * 0.85);
        c = h * (0.35 + 0.65 * luma(base));
        if (P.viz2.z > 0.5 && f32(writer) != P.viz2.z) { c *= 0.2; }
      }
    }
    case PASS_HEAT: {
      if (heat == 0u) { c = vec3f(0.0); }
      else { c = turbo(log2(f32(heat) + 1.0) / log2(max(P.viz.y, 2.0) + 1.0)); }
    }
    case PASS_MATCHES: {
      c = base * 0.25;
      if (matches > 0u) {
        let m = log2(f32(matches) + 1.0) / log2(max(P.viz2.y, 1.0) + 1.0);
        c = mix(c, turbo(0.25 + 0.75 * m), 0.85);
      }
    }
    case PASS_POTENTIAL: {
      if (pot < 0) { c = base * 0.12; }
      else {
        let v = f32(pot) / max(P.viz.w, 1.0);
        c = turbo(v);
        let band = fract(f32(pot) / 4.0);
        c *= 0.8 + 0.2 * step(0.5, band);
      }
    }
    case PASS_ISOLATE: {
      if (P.viz.z >= 0.0 && f32(s) == P.viz.z) { c = base; }
      else { c = vec3f(luma(base)) * 0.16; }
    }
    default: { c = base; }
  }

  // Cell grid lines once a cell is big enough to carry them.
  if (P.cam.w > 0.5 && cellPx >= 6.0) {
    let f = fract(g);
    let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * cellPx;
    c = mix(c * 0.55, c, smoothstep(0.0, 1.0, e));
  }
  return vec4f(c, 1.0);
}
