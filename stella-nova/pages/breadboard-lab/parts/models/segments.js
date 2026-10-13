// ============================================================================
//  BREADBOARD LAB  ·  parts/models/segments.js — 7-segment digits and dot LCDs
// ----------------------------------------------------------------------------
//  Lit displays without a canvas. Each display is ONE InstancedMesh: one
//  instance per segment (or per LCD dot), with a per-instance colour. A lit
//  segment takes the "on" colour scaled by brightness; an unlit one a dim
//  ghost. The material ignores tone mapping, so a lit segment reads as light.
//
//  Segment order per digit: a b c d e f g dp (a top, then clockwise, g the
//  middle bar, dp the point). SEG_FONT maps the characters a meter needs.
//
//  GREP MAP
//    SEG_NAMES / SEG_FONT ... segment order, character -> segment bits
//    encodeText ............. '12.34' -> per-digit bit masks (dots merge)
//    segDisplay ............. N digits as one InstancedMesh: setSegments / setText
//    dotMatrix .............. cols x rows character cells of 5 x 8 dots: setRows
// ============================================================================
import { glyphRows } from './font5x7.js';

export const SEG_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
// bit i = SEG_NAMES[i]
const S = s => [...s].reduce((m, c) => m | (1 << SEG_NAMES.indexOf(c)), 0);
export const SEG_FONT = {
  '0': S('abcdef'), '1': S('bc'), '2': S('abdeg'), '3': S('abcdg'), '4': S('bcfg'),
  '5': S('acdfg'), '6': S('acdefg'), '7': S('abc'), '8': S('abcdefg'), '9': S('abcdfg'),
  ' ': 0, '-': S('g'), '_': S('d'), A: S('abcefg'), b: S('cdefg'), C: S('adef'), c: S('deg'),
  d: S('bcdeg'), E: S('adefg'), F: S('aefg'), H: S('bcefg'), h: S('cefg'), L: S('def'),
  n: S('ceg'), o: S('cdeg'), O: S('abcdef'), P: S('abefg'), r: S('eg'), t: S('defg'),
  U: S('bcdef'), u: S('cde'), V: S('bcdef'), y: S('bcdfg'),
};

// '12.34' -> [m0, m1, m2, m3] with the dp bit set on the digit before a '.'
export function encodeText(text, digits) {
  const out = [];
  for (const ch of String(text)) {
    if (ch === '.') { if (out.length) out[out.length - 1] |= 1 << 7; else out.push(1 << 7); continue; }
    out.push(SEG_FONT[ch] ?? SEG_FONT[ch.toUpperCase()] ?? SEG_FONT[ch.toLowerCase()] ?? 0);
  }
  while (out.length < digits) out.unshift(0);     // right aligned
  return out.slice(out.length - digits);
}

// opts: { digits, h (digit height mm), w, gap, thick, slant, on:'#ff2a1a', off, y }
// Digits run along +X from x = 0, the face points up (+Y), the digit top at -Z.
export function segDisplay(THREE, opts) {
  const n = opts.digits || 1;
  const h = opts.h || 7, w = opts.w || h * 0.56, gap = opts.gap ?? h * 0.32;
  const t = opts.thick || h * 0.12, sl = opts.slant ?? 0.1;
  const on = new THREE.Color(opts.on || '#ff2a1a');
  const off = new THREE.Color(opts.off || '#2a1a18');
  const geo = new THREE.BoxGeometry(1, 0.1, 1);
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, n * 8);
  mesh.name = 'segments';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const hh = h / 2;
  // segment centre (x, z) in a digit frame (z down = toward the bottom), length, horizontal?
  const SEGS = [
    [0, -hh, w, true], [w / 2, -hh / 2, hh, false], [w / 2, hh / 2, hh, false], [0, hh, w, true],
    [-w / 2, hh / 2, hh, false], [-w / 2, -hh / 2, hh, false], [0, 0, w, true],
  ];
  for (let d = 0; d < n; d++) {
    const cx = d * (w + gap) + w / 2;
    for (let i = 0; i < 8; i++) {
      let x, z, sx, sz;
      if (i === 7) { x = cx + w / 2 + gap * 0.35; z = hh; sx = sz = t * 1.2; }
      else {
        const [ox, oz, len, hor] = SEGS[i];
        x = cx + ox - oz * sl; z = oz;
        if (hor) { sx = len - t * 0.6; sz = t; } else { sx = t; sz = len - t * 0.6; }
      }
      p.set(x, opts.y || 0, z); s.set(sx, 1, sz);
      m4.compose(p, q, s);
      mesh.setMatrixAt(d * 8 + i, m4);
      mesh.setColorAt(d * 8 + i, off);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  const tmp = new THREE.Color();
  const level = new Float32Array(n * 8);
  function setSeg(k, b) {
    const v = Math.max(0, Math.min(1.5, b || 0));
    if (Math.abs(level[k] - v) < 1e-3) return false;
    level[k] = v;
    if (v <= 0.01) tmp.copy(off); else tmp.copy(off).lerp(on, Math.min(1, 0.25 + 0.75 * v)).multiplyScalar(v > 1 ? v : 1);
    mesh.setColorAt(k, tmp);
    return true;
  }
  return {
    mesh, width: n * (w + gap) - gap, height: h, level,
    // per digit: an array of 8 brightness values, or a map { a:.., dp:.. }
    setDigit(d, seg) {
      let ch = false;
      for (let i = 0; i < 8; i++) ch = setSeg(d * 8 + i, Array.isArray(seg) ? seg[i] : seg[SEG_NAMES[i]]) || ch;
      if (ch) mesh.instanceColor.needsUpdate = true;
    },
    setMasks(masks, b = 1) {
      let ch = false;
      for (let d = 0; d < n; d++) for (let i = 0; i < 8; i++) ch = setSeg(d * 8 + i, (masks[d] >> i) & 1 ? b : 0) || ch;
      if (ch) mesh.instanceColor.needsUpdate = true;
    },
    setText(text, b = 1) { this.setMasks(encodeText(text, n), b); },
    setColor(hex) { on.set(hex); level.fill(-1); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// cols x rows cells of 5 x 8 dots. Face up, row 0 at -Z. dot pitch p (mm).
export function dotMatrix(THREE, opts) {
  const cols = opts.cols || 16, rows = opts.rows || 2;
  const p = opts.pitch || 0.6, cg = opts.cellGap || 0.35, rg = opts.rowGap || 0.6;
  const cw = 5 * p + cg, ch = 8 * p + rg;
  const geo = new THREE.PlaneGeometry(p * 0.86, p * 0.86);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const N = cols * rows * 40;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'lcd-dots';
  const ink = new THREE.Color(opts.ink || '#1c2a10');
  const blank = new THREE.Color(opts.blank || '#8fae2f');
  const m4 = new THREE.Matrix4();
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) {
    m4.makeTranslation(c * cw + x * p + p / 2, opts.y || 0, r * ch + y * p + p / 2);
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, blank);
    k++;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  const shown = new Array(rows).fill(null);
  let cursorKey = '';
  const state = new Uint8Array(N);
  const tmpOn = new THREE.Color(), tmpOff = new THREE.Color();
  let light = 1;
  function paint(i, on) {
    state[i] = on ? 1 : 0;
    mesh.setColorAt(i, on ? tmpOn : tmpOff);
  }
  function recolor() {
    tmpOff.copy(blank).multiplyScalar(0.35 + 0.65 * light);
    tmpOn.copy(ink);
    for (let i = 0; i < N; i++) mesh.setColorAt(i, state[i] ? tmpOn : tmpOff);
    mesh.instanceColor.needsUpdate = true;
  }
  recolor();
  return {
    mesh, width: cols * cw - cg, height: rows * ch - rg, cols, rows,
    // rows: [string, string]; cursor: { r, c, on }
    setRows(lines, cursor) {
      let changed = false;
      for (let r = 0; r < rows; r++) {
        const s = String((lines && lines[r]) || '').padEnd(cols).slice(0, cols);
        if (s === shown[r]) continue;
        shown[r] = s; changed = true;
        for (let c = 0; c < cols; c++) {
          const g = glyphRows(s.charCodeAt(c));
          const b0 = ((r * cols) + c) * 40;
          for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) paint(b0 + y * 5 + x, (g[y] >> (4 - x)) & 1);
          for (let x = 0; x < 5; x++) paint(b0 + 35 + x, 0);
        }
      }
      const ck = cursor && cursor.on ? cursor.r + ':' + cursor.c : '';
      if (ck !== cursorKey) {
        const put = (key, on) => {
          if (!key) return;
          const [r, c] = key.split(':').map(Number);
          if (r < 0 || r >= rows || c < 0 || c >= cols) return;
          const b0 = ((r * cols) + c) * 40;
          for (let x = 0; x < 5; x++) paint(b0 + 35 + x, on);
        };
        put(cursorKey, 0); put(ck, 1); cursorKey = ck; changed = true;
      }
      if (changed) mesh.instanceColor.needsUpdate = true;
      return changed;
    },
    setLight(b) {
      const v = Math.max(0, Math.min(1.2, b));
      if (Math.abs(v - light) < 0.02) return;
      light = v; recolor();
    },
    text: () => shown.map(s => s || ''),
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
