// ============================================================================
//  RANDOMA11Y  ·  contrast.js — the color-pair math, no DOM dependency
// ────────────────────────────────────────────────────────────────────────────
//  randoma11y rolls random color pairs and keeps the ones that pass a contrast
//  gate. Two metrics score a pair: the WCAG 2 contrast ratio and the APCA Lc.
//  main.js imports these functions. It also prints their source in the
//  reference panel, so the shown code is the running code.
//
//  The idea and the reject-until-pass loop follow randoma11y.com:
//      components-ai/randoma11y   (the app, MIT)
//      johno/random-a11y-combo    (the twelve-line core, MIT)
// ============================================================================

// a random 24-bit color, as a #rrggbb string
export const randomHex = () =>
  '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');

// '#rrggbb' -> [r, g, b], each channel 0..255
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// WCAG 2 relative luminance. Each sRGB channel is linearized, then the three
// channels are weighted. The 0.03928 knee matches get-contrast.
export const srgbToLinear = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
export const relLuminance = ([r, g, b]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

// WCAG 2 contrast ratio, 1..21. The lighter luminance is L1.
export const wcagRatio = (rgbA, rgbB) => {
  const a = relLuminance(rgbA), b = relLuminance(rgbB);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
};

// APCA Lc (APCA-W3 0.1.9 core). Lc is signed. A positive Lc means dark text on a
// light background. A negative Lc means light text on a dark background. main.js
// reports the size and the sign apart.
export const apcaLc = (textRgb, bgRgb) => {
  const Ntx = 0.57, Nbg = 0.56, Rtx = 0.62, Rbg = 0.65;
  const blkThrs = 0.022, blkClmp = 1.414, scale = 1.14, offset = 0.027;
  const loClip = 0.1, dYmin = 0.0005;
  const luma = ([r, g, b]) =>
    0.2126729 * Math.pow(r / 255, 2.4) +
    0.7151522 * Math.pow(g / 255, 2.4) +
    0.0721750 * Math.pow(b / 255, 2.4);
  let ytx = luma(textRgb), ybg = luma(bgRgb);
  ytx = ytx > blkThrs ? ytx : ytx + Math.pow(blkThrs - ytx, blkClmp);
  ybg = ybg > blkThrs ? ybg : ybg + Math.pow(blkThrs - ybg, blkClmp);
  if (Math.abs(ybg - ytx) < dYmin) return 0;
  let lc;
  if (ybg > ytx) {
    const s = (Math.pow(ybg, Nbg) - Math.pow(ytx, Ntx)) * scale;
    lc = s < loClip ? 0 : s - offset;
  } else {
    const s = (Math.pow(ybg, Rbg) - Math.pow(ytx, Rtx)) * scale;
    lc = s > -loClip ? 0 : s + offset;
  }
  return lc * 100;
};

// the contrast gates the generator can aim for. Each gate reads a foreground rgb
// and a background rgb, then returns true when the pair passes.
export const THRESHOLDS = {
  'wcag-aa':  { label: 'WCAG AA · 4.5', test: (fg, bg) => wcagRatio(fg, bg) >= 4.5 },
  'wcag-aaa': { label: 'WCAG AAA · 7',  test: (fg, bg) => wcagRatio(fg, bg) >= 7 },
  'apca-60':  { label: 'APCA · Lc 60',  test: (fg, bg) => Math.abs(apcaLc(fg, bg)) >= 60 },
  'apca-75':  { label: 'APCA · Lc 75',  test: (fg, bg) => Math.abs(apcaLc(fg, bg)) >= 75 },
};

// roll random pairs until one passes the gate. fixedFg or fixedBg locks a color.
// The search returns the pass with its try count, or null after maxTries.
export const generatePair = (gate, { fixedFg = null, fixedBg = null, maxTries = 10000 } = {}) => {
  for (let tries = 1; tries <= maxTries; tries++) {
    const fg = fixedFg || randomHex();
    const bg = fixedBg || randomHex();
    if (gate(hexToRgb(fg), hexToRgb(bg))) return { fg, bg, tries };
  }
  return null;
};
