// ============================================================================
//  MATERIAL STUDIO  ·  panels/panels.test.mjs — characterization test of the
//                                               pure panel helpers
// ────────────────────────────────────────────────────────────────────────────
//  Each row is [[fn, ...args], expected JSON]. The expected values came from
//  the single-file panels.js before the split into panels/. A change here is
//  a change of behaviour. monotone rows sample the curve at fixed x values.
//  tileStat rows use a 16x16 test tile: "flat2" is constant, "ramp" is not.
//  Nine exports have no importer other than this test: normStops, normPts,
//  monotone, enumOptions, benchGroup, hashColors, azElToDir, dirToAzEl and
//  tileStat. Keep those exports, or the test does not load.
//
//  RUN
//      node stella-nova/pages/material-studio/panels/panels.test.mjs
//
//  GREP TARGETS
//      GOLDEN  call  F
// ============================================================================
import { clamp, clone, same, decimals, fmt, evalNum, slug } from './util.js';
import {
  hexToRgb, rgbToHex, toLin, toSrgb, rgbToHsv, hsvToRgb, colorToHex, hexLike,
} from './color.js';
import { catColor } from './graph-access.js';
import { enumOptions } from './widgets/basic.js';
import { normStops } from './widgets/gradient.js';
import { monotone, normPts } from './widgets/curve.js';
import { ballCss } from './material-view.js';
import { benchGroup, fuzzy } from './library.js';
import { tileStat } from './maps-strip.js';
import { hashColors, azElToDir, dirToAzEl } from './env-panel.js';

const F = {
  decimals, fmt, evalNum, clamp, clone, same, slug, hexToRgb, rgbToHex, toLin, toSrgb,
  rgbToHsv, hsvToRgb, colorToHex, hexLike, normStops, normPts, monotone, fuzzy,
  enumOptions, catColor, ballCss, benchGroup, hashColors, azElToDir, dirToAzEl, tileStat,
};

const GOLDEN = [
  [["decimals", 0.01], "2"],
  [["decimals", 1], "0"],
  [["decimals", 0], "0"],
  [["decimals", 0.0001], "4"],
  [["decimals", 1e-09], "5"],
  [["decimals", 0.25], "1"],
  [["fmt", 0.123456, 0.01], "\"0.12\""],
  [["fmt", 3.7, 1], "\"4\""],
  [["fmt", "x", 0.1], "\"x\""],
  [["fmt", -2.5, 0.001], "\"-2.500\""],
  [["evalNum", "0.5"], "0.5"],
  [["evalNum", " 1,5 "], "1.5"],
  [["evalNum", "0.5*2"], "1"],
  [["evalNum", "1/3"], "0.3333333333333333"],
  [["evalNum", "(2+3)*4"], "20"],
  [["evalNum", "abc"], "null"],
  [["evalNum", "1e3"], "1000"],
  [["evalNum", "2**"], "null"],
  [["evalNum", ".5"], "0.5"],
  [["clamp", 5, 0, 1], "1"],
  [["clamp", -1, 0, 1], "0"],
  [["clamp", 0.3, 0, 1], "0.3"],
  [["clone", {"a": [1, {"b": 2}]}], "{\"a\":[1,{\"b\":2}]}"],
  [["clone", null], "null"],
  [["clone", 7], "7"],
  [["same", [1, 2], [1, 2]], "true"],
  [["same", {"a": 1}, {"a": 2}], "false"],
  [["slug", "My Material!"], "\"My_Material\""],
  [["slug", "  __x__ "], "\"x\""],
  [["slug", ""], "\"material\""],
  [["slug", null], "\"material\""],
  [["slug", "a-b_c d"], "\"a-b_c_d\""],
  [["hexToRgb", "#ff8000"], "[1,0.5019607843137255,0]"],
  [["hexToRgb", "f80"], "[1,0.5333333333333333,0]"],
  [["hexToRgb", "zzz"], "[0,0,0]"],
  [["hexToRgb", null], "[0,0,0]"],
  [["hexToRgb", "#12345678"], "[0.07058823529411765,0.20392156862745098,0.33725490196078434]"],
  [["rgbToHex", [1, 0.5, 0]], "\"#ff8000\""],
  [["rgbToHex", [2, -1, 0.2, 9]], "\"#ff0033\""],
  [["toLin", 0.5], "0.21404114048223255"],
  [["toLin", 0.01], "0.0007739938080495357"],
  [["toSrgb", 0.2], "0.48452920448170694"],
  [["toSrgb", 0.001], "0.012920000000000001"],
  [["rgbToHsv", [1, 0, 0]], "[0,1,1]"],
  [["rgbToHsv", [0.2, 0.4, 0.8]], "[0.611111111111111,0.7500000000000001,0.8]"],
  [["rgbToHsv", [0, 0, 0]], "[0,0,0]"],
  [["rgbToHsv", [0.5, 0.5, 0.1]], "[0.16666666666666666,0.8,0.5]"],
  [["rgbToHsv", [0.3, 0.1, 0.6]], "[0.7333333333333334,0.8333333333333334,0.6]"],
  [["hsvToRgb", [0, 1, 1]], "[1,0,0]"],
  [["hsvToRgb", [0.6, 0.5, 0.8]], "[0.4,0.5600000000000002,0.8]"],
  [["hsvToRgb", [0.999, 0.2, 0.4]], "[0.4,0.32000000000000006,0.32048000000000004]"],
  [["hsvToRgb", [0.35, 1, 0.5]], "[0,0.5,0.04999999999999982]"],
  [["colorToHex", [0.2, 0.5, 1]], "\"#7cbcff\""],
  [["colorToHex", "#abcdef"], "\"#abcdef\""],
  [["colorToHex", 12], "\"#808080\""],
  [["hexLike", "#808080", [0, 0, 0]], "[0.21586050011389926,0.21586050011389926,0.21586050011389926]"],
  [["hexLike", "#808080", "#000000"], "\"#808080\""],
  [["normStops", null], "[{\"t\":0,\"color\":\"#000000\"},{\"t\":1,\"color\":\"#ffffff\"}]"],
  [["normStops", [{"t": 1, "color": "#ff0000"}, {"t": 0, "color": [0, 0, 1]}]], "[{\"t\":0,\"color\":\"#0000ff\"},{\"t\":1,\"color\":\"#ff0000\"}]"],
  [["normStops", [[0.5, 1, 0, 0]]], "[{\"t\":0.5,\"color\":\"#ff0000\"},{\"t\":1,\"color\":\"#ff0000\"}]"],
  [["normStops", [{"t": "x", "color": 3}]], "[{\"t\":0,\"color\":\"#808080\"},{\"t\":1,\"color\":\"#808080\"}]"],
  [["normPts", null], "[[0,0],[1,1]]"],
  [["normPts", [[1, 0], [0, 1], [0.5, 0.5]]], "[[0,1],[0.5,0.5],[1,0]]"],
  [["normPts", [{"x": 0.2, "y": 0.3}, {"x": 0.1}]], "[[0.1,0],[0.2,0.3]]"],
  [["normPts", [[0, 0]]], "[[0,0],[1,1]]"],
  [["monotone", [[0, 0], [0.25, 0.08], [0.75, 0.92], [1, 1]]], "[0,0,0.016749196777234344,0.17941181487720356,0.5000000000000001,0.7369557080757669,0.9832508032227656,1,1]"],
  [["monotone", [[0, 0], [0.5, 1], [1, 0]]], "[0,0,0.23200000000000004,0.8081040000000002,1,0.8986240000000001,0.23199999999999987,0,0]"],
  [["monotone", [[0, 0.3]]], "[0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.3]"],
  [["monotone", [[0, 0], [0.5, 0.5], [0.6, 0.5], [1, 1]]], "[0,0,0.11600000000000002,0.4040520000000001,0.5,0.5024375,0.8515625000000001,1,1]"],
  [["fuzzy", "prln", "perlin noise"], "8.88"],
  [["fuzzy", "zz", "perlin"], "-1"],
  [["fuzzy", "", "x"], "0"],
  [["fuzzy", "pn", "perlin noise"], "4.88"],
  [["fuzzy", "ns", "noise.simplex"], "4.87"],
  [["enumOptions", {"options": ["a", {"value": 2, "label": "Two"}, {"value": "c"}]}], "[{\"value\":\"a\",\"label\":\"a\"},{\"value\":\"2\",\"label\":\"Two\"},{\"value\":\"c\",\"label\":\"c\"}]"],
  [["enumOptions", {}], "[]"],
  [["catColor", "Noise"], "\"#7ad0c0\""],
  [["catColor", "Nope"], "\"#8090b0\""],
  [["catColor", null], "\"#8090b0\""],
  [["ballCss", "#ff0000"], "\"radial-gradient(circle at 34% 30%, rgba(255,255,255,0.75) 0, rgba(255,255,255,0) 22%), radial-gradient(circle at 40% 38%, #ff0000 0, #ff0000 62%, #05070b 100%)\""],
  [["ballCss", ["#111111", "#222222"]], "\"radial-gradient(circle at 34% 30%, rgba(255,255,255,0.75) 0, rgba(255,255,255,0) 22%), radial-gradient(circle at 40% 38%, #111111 0, #222222 62%, #05070b 100%)\""],
  [["ballCss", null], "\"radial-gradient(circle at 34% 30%, rgba(255,255,255,0.75) 0, rgba(255,255,255,0) 22%), radial-gradient(circle at 40% 38%, #888888 0, #888888 62%, #05070b 100%)\""],
  [["benchGroup", {"type": "bench.terrain.x"}], "\"terrain\""],
  [["benchGroup", {"type": "bench", "libLabel": "L"}], "\"L\""],
  [["benchGroup", {"type": "a", "benchLibLabel": "B", "lib": "c"}], "\"B\""],
  [["benchGroup", {"type": "solo"}], "\"bench\""],
  [["hashColors", "studio"], "[\"hsl(214 40% 72%)\",\"hsl(244 25% 32%)\",\"hsl(264 20% 10%)\"]"],
  [["hashColors", ""], "[\"hsl(0 40% 72%)\",\"hsl(30 25% 32%)\",\"hsl(50 20% 10%)\"]"],
  [["azElToDir", 45, 35], "[0.5792,0.5736,0.5792]"],
  [["azElToDir", 0, 90], "[0,1,0]"],
  [["azElToDir", 270, -10], "[-0.9848,-0.1736,0]"],
  [["dirToAzEl", [0, 1, 0]], "[0,90]"],
  [["dirToAzEl", [1, 1, 1]], "[45,35.264389682754654]"],
  [["dirToAzEl", null], "[0,90]"],
  [["dirToAzEl", [0, 0, 0]], "[0,0]"],
  [["tileStat", "flat2", 2], "\"flat 0.30\""],
  [["tileStat", "ramp", 2], "\"0.00\u20130.99\""],
  [["tileStat", "flat2", 0], "\"flat #4da221\""],
  [["tileStat", "ramp", 1], "\"\""]
];

function call([fn, ...a]) {
  if (fn === 'monotone') { const f = F.monotone(a[0]); return [-0.1, 0, 0.1, 0.33, 0.5, 0.62, 0.9, 1, 1.2].map(f); }
  if (fn === 'tileStat') {
    const d = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < d.length; i += 4) { const v = a[0] === 'ramp' ? (i / 4) % 256 : 77; d[i] = v; d[i + 1] = 200 - (v >> 1); d[i + 2] = 33; d[i + 3] = 255; }
    return F.tileStat({ data: d }, { mode: a[1] });
  }
  return F[fn](...a);
}

let fail = 0;
for (const [c, want] of GOLDEN) {
  const got = JSON.stringify(call(c));
  if (got !== want) { fail++; console.log(`FAIL ${c[0]}(${JSON.stringify(c.slice(1))}): want ${want}, got ${got}`); }
}
console.log(`panels.test: ${GOLDEN.length - fail}/${GOLDEN.length} pass`);
process.exit(fail ? 1 : 0);
