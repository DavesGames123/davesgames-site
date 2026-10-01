// theme.js -- the paper palette and the animation speeds, in one place.
//
// Port of origami src/theme.rs. Every colour is stored LINEAR, because the
// canvas renders through an sRGB view and the shaders emit linear light. A
// colour named in sRGB is decoded once by `lin` when a palette is built.
//
// The crease colours follow the ORIPA convention: a mountain is red, a valley is
// blue, a paper boundary is near-ink, and an auxiliary line is faint.
//
// The native app has a light and a dark palette. Both are ported as data. The
// web page is dark only and draws with `site`: the dark palette, with the ground
// and panel tokens moved to the cool near-black of the Stella Nova pages. The
// crease, accent, and text tokens are the native dark values.
//
// grep map:
//   lin / dim / mix -- sRGB byte triple to linear colour, alpha scale, blend
//   light / dark    -- the two native palettes
//   site            -- the palette this page draws with
//   PASTELS / facePastel -- the per-face paper tints (app.rs face_pastel)
//   css             -- a linear colour back to a CSS rgb() string
//   OPEN_SPEED and the speeds below -- the native easing rates, 1/s

export function lin(c) {
  const f = (b) => {
    const s = b / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f(c[0]), f(c[1]), f(c[2]), 1];
}

export function dim(c, a) { return [c[0], c[1], c[2], c[3] * a]; }

export function mix(a, b, t) {
  t = Math.min(Math.max(t, 0), 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

export function light() {
  return {
    canvas: lin(hex(0xEFE9DD)), panel: lin(hex(0xFBF7EF)), panelHead: lin(hex(0xF2EBDB)),
    group: lin(hex(0xF5EFE3)), field: lin(hex(0xFDFBF6)), btn: lin(hex(0xEEE6D6)),
    btnHover: lin(hex(0xE4D9C4)), edge: lin(hex(0xD7CDBA)), accent: lin(hex(0xC0553A)),
    text: lin(hex(0x3A3226)), textDim: lin(hex(0x8A7E68)), caret: lin(hex(0xC0553A)),
    mountain: lin(hex(0xC2412E)), valley: lin(hex(0x2E5EA6)), border: lin(hex(0x3A3226)),
    aux: lin(hex(0xB7A98E)), grid: lin(hex(0xDDD4C2)),
  };
}

export function dark() {
  return {
    canvas: lin(hex(0x1A1712)), panel: lin(hex(0x221E18)), panelHead: lin(hex(0x2A251E)),
    group: lin(hex(0x262119)), field: lin(hex(0x14110C)), btn: lin(hex(0x2E2820)),
    btnHover: lin(hex(0x3A3328)), edge: lin(hex(0x3E362A)), accent: lin(hex(0xE08A5C)),
    text: lin(hex(0xECE4D4)), textDim: lin(hex(0x9A8F7C)), caret: lin(hex(0xF09A66)),
    mountain: lin(hex(0xE0614A)), valley: lin(hex(0x6A9BD8)), border: lin(hex(0xC9BCA0)),
    aux: lin(hex(0x6A6152)), grid: lin(hex(0x2A251D)),
  };
}

// The page palette: native dark, on the site's cool ground. The CSS in
// style.css names the same hex values.
export function site() {
  return {
    ...dark(),
    canvas: lin(hex(0x0A0C12)),
    panel: lin(hex(0x12151D)),
    field: lin(hex(0x080A0F)),
    btn: lin(hex(0x191D27)),
    btnHover: lin(hex(0x232836)),
    edge: lin(hex(0x2A3040)),
    // The grid draws over the pastel faces. The native dark grid (2A251D) is a
    // dark ink line, kept as is.
    grid: lin(hex(0x2A251D)),
    // The web additions: the foldability marks.
    bad: lin(hex(0xFFC857)),
    good: lin(hex(0x7FD69A)),
  };
}

// A muted paper tint per face, cycled by face index (app.rs face_pastel).
// The native app uses light pastels. The web page is dark, so the tints are
// deep, muted tones: light pastels were too bright on the dark ground. The
// names stay PASTELS and facePastel, because the shader and main.js use them.
export const PASTELS = [
  [0x8A, 0x5A, 0x55], // rose
  [0x8C, 0x6A, 0x4E], // peach
  [0x85, 0x7A, 0x4C], // butter
  [0x5E, 0x75, 0x56], // sage
  [0x54, 0x6E, 0x86], // sky
  [0x6E, 0x60, 0x86], // lilac
  [0x7D, 0x6B, 0x55], // sand
  [0x84, 0x5A, 0x6A], // blush
];
const PASTELS_LIN = PASTELS.map(lin);
export function facePastel(face) { return PASTELS_LIN[face % PASTELS_LIN.length]; }

// A linear colour back to a CSS colour, for the DOM controls.
export function css(c) {
  const e = (x) => Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  return `rgba(${e(c[0])},${e(c[1])},${e(c[2])},${c[3]})`;
}

// The native easing rates, in units of one over a second. The web controls use
// CSS transitions; these set their durations (about 3 / speed seconds).
export const OPEN_SPEED = 13.0;
export const EXPAND_SPEED = 16.0;
export const HOVER_SPEED = 20.0;
export const FOLLOW_SPEED = 14.0;
export const RAIL_SPEED = 24.0;
export const CONTENT_T = 0.45;
