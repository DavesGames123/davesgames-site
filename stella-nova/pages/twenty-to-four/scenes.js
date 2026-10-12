// ============================================================================
//  TWENTY TO FOUR  ·  scenes.js — what the stage draws for each chapter
// ----------------------------------------------------------------------------
//  createStage(R) returns { draw(S, now), pick(S, x, y), restartFold(),
//  fontsReady(), readouts }. draw() is called once per frame with the page
//  state S (main.js) and the wall clock now (s). It eases the camera to the
//  scene's preset, then draws, back to front:
//      sheets (field.js formulas in the shader) -> meshes -> glows
//        -> geometry lines and arrowheads -> sprites (labels, formulas)
//
//  SCENES
//      fold    the twenty lines flow into the four laws, and the four into
//              the two forms (screen space, the field dim behind)
//      field   the dipole in the plane, flat, with a map and the rings
//      curlB   three small loops round the probe; their circulations add
//      curlE   into the curl, which lands on the displacement current or
//              on −∂B/∂t
//      div     a small cube round the probe; face fluxes in pairs
//      four    the field in 3D: two sheets, B rings, the radiation lobe
//      gauge   the gauged A as arrows round a breathing χ blob, flat
//      forms   the boundary of a boundary: face loops cancel on each edge
//
//  readouts (filled each frame, main.js shows them in the column):
//      curl  { lines:[3], loops:[3], cmp:[3] }   div { terms:[3], faces:[6] }
//      gauge { dE, dB, dA }
//
//  GREP MAP
//      grep -n "const PRESET"          camera per scene
//      grep -n "function foldLayout"   tile, law and form positions
//      grep -n "function drawFold"     the 20 -> 4 -> 2 timeline
//      grep -n "function drawCurl"     the three loops
//      grep -n "function drawDiv"      the cube of fluxes
//      grep -n "function drawFour"     the 3D field
//      grep -n "function drawForms"    the boundary of a boundary
//      grep -n "function eqSprite"     formula and text textures
// ============================================================================
import * as F from './field.js';
import { SegBuf, HEX, rgb, viewMatrix, screenMatrix, project, eyeOf, add3, scl3, sub3, norm3, cross3 } from './render.js';
import { drawEq, eqBox, has } from './math.js';
import { GROUPS } from './tex.js';

const FOV = 32 * Math.PI / 180, TANH = Math.tan(FOV / 2);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const C = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, rgb(v)]));
const VIOLET = rgb('#8676ff'), WHITE = [0.94, 0.95, 0.96, 1], DIM = [0.62, 0.66, 0.72, 1];
const withA = (c, a) => [c[0], c[1], c[2], a];
const E3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Camera per scene. half: the half-height of the view in world units at
// the target; the distance follows from the field of view.
const PRESET = {
  fold: { target: [0, 0, 0], yaw: 0, pitch: 0, half: 2.3 },
  field: { target: [0, 0, 0], yaw: 0, pitch: 0, half: 1.75 },
  curlB: { target: 'probe', yaw: -0.62, pitch: 0.36, half: 0.42, orbit: 0.05 },
  curlE: { target: 'probe', yaw: -0.62, pitch: 0.36, half: 0.42, orbit: 0.05 },
  div: { target: 'probe', yaw: -0.55, pitch: 0.42, half: 0.42, orbit: 0.05 },
  four: { target: [0, 0, 0], yaw: -0.5, pitch: 0.34, half: 1.65, orbit: 0.07 },
  gauge: { target: [0.62, 0, 0.3], yaw: 0, pitch: 0, half: 0.78 },
  forms: { target: 'probe', yaw: -0.7, pitch: 0.5, half: 0.4, orbit: 0.06 },
};
export const SCENES = Object.keys(PRESET);
export const FLAT = new Set(['fold', 'field', 'gauge']);

export function createStage(R) {
  const lines = new SegBuf(4096), heads = new SegBuf(512), over = new SegBuf(1024), overHeads = new SegBuf(256);
  const cam = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 8, fov: FOV };
  let camInit = false, lastScene = '', foldT0 = 0;
  const auto = { phase: 0, yaw: 0 };
  const readouts = { curl: null, div: null, gauge: null };

  // ── sprites: formula and text textures, cached by key and device size ──
  const cache = new Map();
  let fontGen = 0;
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(w)); c.height = Math.max(2, Math.ceil(h)); return c; }
  // A formula sprite at font size px (CSS). Returns { tex, w, h, asc, pad, px }.
  function eqSprite(key, px) {
    const dev = Math.max(8, Math.ceil(px * R.dpr * 1.25 / 4) * 4);
    const id = 'e|' + key + '|' + dev;
    let s = cache.get(id);
    if (s) { s.used = performance.now(); return s; }
    if (!has(key)) return null;
    const b = eqBox(key, dev), pad = Math.ceil(dev * 0.25);
    const cv = makeCanvas(b.w + pad * 2, b.h + pad * 2), ctx = cv.getContext('2d');
    drawEq(ctx, key, pad, pad + b.asc, dev);
    s = { tex: R.texture(cv), cw: cv.width, ch: cv.height, asc: (pad + b.asc), pad, dev, used: performance.now() };
    cache.set(id, s); trim();
    return s;
  }
  // A text sprite: font is a CSS font with {px} for the size.
  function textSprite(text, font, color, px) {
    const dev = Math.max(8, Math.ceil(px * R.dpr * 1.25 / 2) * 2);
    const id = 't|' + text + '|' + font + '|' + color + '|' + dev + '|' + fontGen;
    let s = cache.get(id);
    if (s) { s.used = performance.now(); return s; }
    const f = font.replace('{px}', dev + 'px');
    const m = makeCanvas(4, 4).getContext('2d');
    m.font = f;
    const w = m.measureText(text).width, pad = Math.ceil(dev * 0.3);
    const cv = makeCanvas(w + pad * 2, dev * 1.4 + pad * 2), ctx = cv.getContext('2d');
    ctx.font = f; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, pad, pad + dev * 1.05);
    s = { tex: R.texture(cv), cw: cv.width, ch: cv.height, asc: pad + dev * 1.05, pad, dev, used: performance.now() };
    cache.set(id, s); trim();
    return s;
  }
  function trim() {
    if (cache.size < 260) return;
    const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 60);
    for (const [k, s] of old) { R.dropTexture(s.tex); cache.delete(k); }
  }
  // Draw a sprite made at size dev, shown at CSS font size px. (x, y) is
  // the baseline start; align 0 left, 0.5 centre, 1 right.
  function put(s, x, y, px, alpha = 1, align = 0) {
    if (!s || alpha <= 0.002) return null;
    const k = px / s.dev, w = s.cw * k, h = s.ch * k;
    const left = x - s.pad * k - (w - 2 * s.pad * k) * align, top = y - s.asc * k;
    R.sprite(s.tex, left, top, w, h, alpha);
    return { x: left + s.pad * k, y: top + s.pad * k, w: w - 2 * s.pad * k, h: h - 2 * s.pad * k };
  }
  const eqW = (key, px) => eqBox(key, px).w;
  const SERIF = "italic 400 {px} 'STIX Two Text', 'Times New Roman', serif";
  const SANS = "500 {px} Inter, system-ui, sans-serif";

  // ── the radiation lobe, r = L sin²θ, made once ─────────────────────────
  const LOBE = 1.3, NT = 48, NP = 72;
  const lobe = (() => {
    const pos = new Float32Array((NT + 1) * (NP + 1) * 3), nrm = new Float32Array(pos.length), idx = [];
    const P = (th, ph) => { const r = LOBE * Math.sin(th) ** 2; return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]; };
    for (let i = 0; i <= NT; i++) for (let j = 0; j <= NP; j++) {
      const th = Math.PI * i / NT, ph = 2 * Math.PI * j / NP, o = (i * (NP + 1) + j) * 3, e = 1e-3;
      const p = P(th, ph), a = sub3(P(th + e, ph), P(th - e, ph)), b = sub3(P(th, ph + e), P(th, ph - e));
      let n = cross3(a, b);
      if (Math.hypot(...n) < 1e-9) n = p; n = norm3(n);
      pos.set(p, o); nrm.set(n, o);
      if (i < NT && j < NP) { const q = i * (NP + 1) + j; idx.push(q, q + NP + 1, q + 1, q + 1, q + NP + 1, q + NP + 2); }
    }
    return R.makeMesh({ pos, nrm, idx: new Uint16Array(idx) });
  })();
  // Six face quads for the cube scenes, updated in place each frame.
  const faceMesh = R.makeMesh({ pos: new Float32Array(12), nrm: new Float32Array(12), idx: new Uint16Array([0, 1, 2, 0, 2, 3]) });
  const quadPos = new Float32Array(12), quadNrm = new Float32Array(12);
  function face(M, eye, c, n, u, v, col, alpha) {
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    cs.forEach(([a, b], i) => { quadPos.set(add3(c, add3(scl3(u, a), scl3(v, b))), i * 3); quadNrm.set(n, i * 3); });
    R.updateMesh(faceMesh, { pos: quadPos, nrm: quadNrm });
    R.mesh(M, faceMesh, eye, col, alpha, 0.6, 0.35);
  }

  // ── camera ─────────────────────────────────────────────────────────────
  function goal(S) {
    const p = PRESET[S.scene] || PRESET.field;
    const target = p.target === 'probe' ? S.probe.slice() : p.target.slice();
    const zoom = S.view.zoom || 1;
    let yaw = p.yaw + (S.view.yaw || 0), pitch = clamp(p.pitch + (S.view.pitch || 0), -1.35, 1.35);
    // The slow auto orbit advances only while nobody holds the camera, so a
    // drag never ends in a jump.
    if (p.orbit) yaw += Math.sin(auto.phase * p.orbit * 2) * 0.35;
    if (S.scene === 'four') yaw += auto.yaw;
    const half = p.half * zoom * (S.camHalf || 1);
    const tg = S.camTarget || target;
    return { target: tg, yaw, pitch, dist: half / TANH, fov: FOV };
  }
  function easeCam(g, dt, snap) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.2);
    for (let i = 0; i < 3; i++) cam.target[i] = lerp(cam.target[i], g.target[i], k);
    let dy = g.yaw - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    cam.yaw += dy * k; cam.pitch = lerp(cam.pitch, g.pitch, k);
    cam.dist = Math.exp(lerp(Math.log(cam.dist), Math.log(g.dist), k));
  }

  // The band transform: the scene sits in the clear part of the stage.
  function bandOf(S, H) {
    const b = S.band;
    if (!b) return { s: 1, xc: 0, yc: 0, t: 0, h: H };
    const h = Math.max(40, H - b.t - b.b);
    return { s: h / H, xc: 0, yc: 1 - 2 * (b.t + h / 2) / H, t: b.t, h };
  }

  // ── sheets and the source ──────────────────────────────────────────────
  function sheetAt(M, S, phi, o) {
    const k = F.kOf(S.lam), c = Math.cos(phi), s = Math.sin(phi);
    R.sheet({
      M, O: [0, 0, 0], U: [c, s, 0], Wv: [0, 0, 1], R: o.R, k, t: S.t, lam: S.lam,
      alpha: o.alpha, lineGap: S.lineGap || 0.28, lineA: o.lineA ?? 1, map: o.map ?? S.map, mapA: o.mapA ?? 0.55,
      ringA: o.ringA ?? 1, half: !!o.half, arrows: o.arrows || 0, arrowCell: o.cell || 0.14, mask: o.mask || 0.035, gauge: o.gauge,
    });
  }
  function source(M, S, W, H, size = 1) {
    const k = F.kOf(S.lam), p = Math.cos(k * S.t);
    const top = project(M, [0, 0, 0.05], W, H), bot = project(M, [0, 0, -0.05], W, H);
    const px = 46 * size;
    if (top) R.sprite(null, top[0] - px / 2, top[1] - px / 2, px, px, 0.35 + 0.65 * Math.max(0, p), 1, C.Q);
    if (bot) R.sprite(null, bot[0] - px / 2, bot[1] - px / 2, px, px, 0.35 + 0.65 * Math.max(0, -p), 1, C.Q);
    const mid = project(M, [0, 0, 0], W, H);
    if (mid) R.sprite(null, mid[0] - px * 0.7, mid[1] - px * 0.7, px * 1.4, px * 1.4, 0.25, 1, [1, 0.9, 0.85]);
  }

  // ── arrows ─────────────────────────────────────────────────────────────
  function arrow(L, Hh, a, b, col, w = 2, head = 9) {
    if (Math.hypot(...sub3(b, a)) < 1e-6) return;
    L.seg(a, b, col, w); Hh.seg(b, a, col, head);
  }

  // ── fold: the twenty, the four, the two ────────────────────────────────
  // Order of the groups in the timeline: by the law each one feeds.
  const FOLD_ORDER = [6, 1, 3, 0, 2, 4, 5, 7];
  const LAW_KEYS = ['lawI', 'lawII', 'lawIII', 'lawIV'];
  const LAW_COL = { I: C.E, II: C.B, III: C.E, IV: C.B, diel: DIM, ohm: DIM, cont: DIM };
  const ASIDE = ['diel', 'ohm', 'cont'];
  const lawIndex = l => ['I', 'II', 'III', 'IV'].indexOf(l);
  const tileKey = i => 'm' + String(i + 1).padStart(2, '0');
  // The widest Maxwell line, in em.
  let maxTileEm = 0;
  function tileEm() { if (!maxTileEm) for (let i = 0; i < 20; i++) maxTileEm = Math.max(maxTileEm, eqW(tileKey(i), 1)); return maxTileEm; }
  // Both arrangements are computed; the one with the larger type wins.
  function foldLayout(rect) {
    const a = foldLayoutAs(rect, true), b = foldLayoutAs(rect, false);
    return b.tiles[0].f > a.tiles[0].f * 1.08 ? b : a;
  }
  function foldLayoutAs(rect, wide) {
    const { x, y, w, h } = rect;
    const em = tileEm();
    const lawEm = Math.max(...LAW_KEYS.map(k => eqW(k, 1)));
    const out = { tiles: [], laws: [], asides: [], forms: [], heads: [] };
    if (wide) {
      // Three columns: the twenty, the four, the two. The twenty go either
      // as eight group rows (short bands) or as a list of twenty (tall
      // bands): the layout with the larger type wins.
      const c1 = w * 0.47, c2 = w * 0.3, c3 = w * 0.17;
      const rowsAvail = h * 0.84, x1 = x + w * 0.03 + 30;
      const rowEm = g => g.lines.reduce((s, li) => s + eqW(tileKey(li), 1), 0) + (g.lines.length - 1) * 0.9;
      const fRows = Math.min(rowsAvail / (GROUPS.length * 1.9), (c1 - 34) / Math.max(...GROUPS.map(rowEm)), 22);
      const nList = 20 + (GROUPS.length - 1) * 0.5;
      const fList = Math.min(rowsAvail / (nList * 1.45), (c1 - 34) / em, 22);
      let f;
      if (fList > fRows) {
        f = fList;
        let row = 0;
        const top = y + h * 0.12 + (rowsAvail - nList * f * 1.45) / 2;
        GROUPS.forEach((g, gi) => {
          out.heads.push({ g: g.g, x: x + w * 0.03, y: top + (row + 0.7) * f * 1.45, f });
          g.lines.forEach(li => { out.tiles[li] = { x: x1, y: top + (row + 0.7) * f * 1.45, f, group: gi }; row++; });
          row += 0.5;
        });
      } else {
        f = fRows;
        const top = y + h * 0.12 + (rowsAvail - GROUPS.length * f * 1.9) / 2;
        GROUPS.forEach((g, gi) => {
          let cx = x1;
          g.lines.forEach(li => {
            out.tiles[li] = { x: cx, y: top + (gi + 0.62) * f * 1.9, f, group: gi };
            cx += eqW(tileKey(li), f) + f * 0.9;
          });
          out.heads.push({ g: g.g, x: x + w * 0.03, y: top + (gi + 0.62) * f * 1.9, f });
        });
      }
      const f2 = Math.min(f * 1.45, (c2 - 20) / lawEm);
      const lx = x + c1 + w * 0.03;
      [0, 1, 2, 3].forEach(i => out.laws.push({ x: lx, y: y + h * (0.2 + i * 0.17), f: f2 }));
      // The asides sit in a row under the laws.
      ASIDE.forEach(k => out.asides.push({ key: k, f: f * 0.95 }));
      let ax = lx;
      out.asides.forEach(a => { a.x = ax; a.y = y + h * 0.9; ax += eqW('law' + a.key, a.f) + f * 1.6; });
      const f3 = Math.min(f * 1.9, (c3 + w * 0.02) / Math.max(eqW('lawdF', 1), eqW('lawdsF', 1)));
      const fx = x + c1 + c2 + w * 0.05;
      out.forms.push({ x: fx, y: y + h * 0.38, f: f3 }, { x: fx, y: y + h * 0.62, f: f3 });
      out.cols = [{ x: x + w * 0.03, y: y + h * 0.06, t: 'Maxwell, 1865 — twenty' }, { x: lx, y: y + h * 0.06, t: 'Heaviside, 1884 — four' }, { x: fx, y: y + h * 0.06, t: 'Forms — two' }];
      out.wide = true;
    } else {
      // Portrait: the twenty in two columns of ten, the four in a 2 × 2
      // grid under them, the two at the base.
      const f = Math.min((w * 0.94) / (2 * em + 1.4), (h * 0.5) / (10 * 1.6), 18);
      const colW = em * f + f * 1.2;
      const x0 = x + (w - 2 * colW) / 2 + f * 0.6;
      let n = 0;
      GROUPS.forEach((g, gi) => g.lines.forEach(li => {
        const col = n < 10 ? 0 : 1, row = n % 10;
        out.tiles[li] = { x: x0 + col * colW, y: y + h * 0.07 + (row + 0.8) * f * 1.6, f, group: gi };
        n++;
      }));
      const f2 = Math.min((w * 0.46) / lawEm, f * 1.3);
      [0, 1, 2, 3].forEach(i => out.laws.push({ x: x + w * (i % 2 ? 0.52 : 0.03), y: y + h * (0.66 + Math.floor(i / 2) * 0.1), f: f2 }));
      const f3 = Math.min(f * 1.6, (w * 0.4) / Math.max(eqW('lawdF', 1), eqW('lawdsF', 1)));
      out.forms.push({ x: x + w * 0.08, y: y + h * 0.95, f: f3 }, { x: x + w * 0.56, y: y + h * 0.95, f: f3 });
      out.cols = [];
      out.wide = false;
    }
    return out;
  }
  // A cubic from (a) to (b), horizontal tangents in the wide layout.
  function bez(a, b, wide, s) {
    const dx = wide ? (b[0] - a[0]) * 0.5 : 0, dy = wide ? 0 : (b[1] - a[1]) * 0.5;
    const p1 = [a[0] + dx, a[1] + dy], p2 = [b[0] - dx, b[1] - dy], u = 1 - s;
    return [u * u * u * a[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * b[0], u * u * u * a[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * b[1], 0];
  }
  function ribbon(L, a, b, wide, s0, s1, col, w) {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const sa = i / n, sb = (i + 1) / n;
      if (sb < s0 || sa > s1) continue;
      L.seg(bez(a, b, wide, Math.max(sa, s0)), bez(a, b, wide, Math.min(sb, s1)), col, w);
    }
  }
  const FOLD_LEN = 17;
  function drawFold(S, W, H, band) {
    const rect = { x: Math.max(16, W * 0.03), y: band.t + band.h * 0.02, w: W - Math.max(32, W * 0.06), h: band.h * 0.96 };
    if (S.foldRect) Object.assign(rect, S.foldRect);
    const Lo = foldLayout(rect), T = ((S.clock - foldT0) % FOLD_LEN + FOLD_LEN) % FOLD_LEN;
    const SM = screenMatrix(W, H);
    over.clear();
    const fade = smooth(T / 0.6) * (1 - smooth((T - (FOLD_LEN - 0.7)) / 0.7));
    const hl = S.hl;   // a group the column points at, or null
    // Column heads.
    for (const c of Lo.cols) put(textSprite(c.t, SANS, '#9aa6b2', 13), c.x, c.y + 13, 13, 0.9 * fade);
    // Group times: group order index -> start time.
    const gStart = gi => 2.2 + FOLD_ORDER.indexOf(gi) * 0.62;
    const lawOn = [0, 0, 0, 0], asideOn = [0, 0, 0];
    const lawPt = (law) => { const li = lawIndex(law); if (li >= 0) { const l = Lo.laws[li]; return [l.x - 8, l.y - l.f * 0.35]; } const a = Lo.asides[ASIDE.indexOf(law)]; return a ? [a.x - 6, a.y - a.f * 0.35] : null; };
    GROUPS.forEach((g, gi) => {
      const t0 = gStart(gi), sent = smooth((T - t0) / 0.9);
      const lawCol = LAW_COL[g.law];
      const li = lawIndex(g.law), ai = ASIDE.indexOf(g.law);
      if (li >= 0) lawOn[li] = Math.max(lawOn[li], smooth((T - t0 - 0.6) / 0.5));
      if (ai >= 0) asideOn[ai] = Math.max(asideOn[ai], smooth((T - t0 - 0.6) / 0.5));
      const dimmed = hl != null && hl !== gi;
      g.lines.forEach((ln, j) => {
        const tl = Lo.tiles[ln], key = tileKey(ln);
        const appear = smooth((T - 0.15 - ln * 0.07) / 0.5);
        const a = appear * fade * (dimmed ? 0.25 : lerp(1, 0.55, sent));
        put(eqSprite(key, tl.f), tl.x + (1 - appear) * -12, tl.y, tl.f, a);
        if (hl === gi) {
          const w = eqW(key, tl.f), y0 = tl.y - tl.f * 1.05, y1 = tl.y + tl.f * 0.45;
          over.poly([[tl.x - 5, y0], [tl.x + w + 5, y0], [tl.x + w + 5, y1], [tl.x - 5, y1]], withA(lawCol, 0.8), 1.2, true);
        }
        // The ribbon from this tile to its law, and a copy that flies along it.
        const end = lawPt(g.law);
        if (!end) return;
        const st = [tl.x + eqW(key, tl.f) + 6, tl.y - tl.f * 0.35];
        const prog = smooth((T - t0 - j * 0.08) / 0.8);
        if (prog > 0) ribbon(over, Lo.wide ? st : [tl.x + eqW(key, tl.f) / 2, tl.y + tl.f * 0.4], end, Lo.wide, 0, prog, withA(lawCol, (dimmed ? 0.1 : 0.32) * fade), 1.3);
        const fly = (T - t0 - j * 0.08) / 0.9;
        if (fly > 0 && fly < 1) {
          const s = smooth(fly), p = bez(Lo.wide ? st : [tl.x, tl.y], end, Lo.wide, s);
          put(eqSprite(key, tl.f), p[0], p[1] + tl.f * 0.35, tl.f * lerp(1, 0.55, s), (1 - s) * 0.9 * fade);
        }
      });
      if (Lo.heads[gi]) put(textSprite(g.g, "600 {px} 'STIX Two Text', serif", '#cfd6dd', Lo.heads[gi].f), Lo.heads[gi].x, Lo.heads[gi].y, Lo.heads[gi].f * 1.05, fade * (dimmed ? 0.3 : 0.85));
    });
    // The four laws, the asides, and the flow into the two forms.
    const formOn = [0, 0];
    LAW_KEYS.forEach((k, i) => {
      const l = Lo.laws[i];
      const lit = hl != null && GROUPS[hl] && lawIndex(GROUPS[hl].law) === i;
      put(eqSprite(k, l.f), l.x, l.y, l.f, lawOn[i] * fade * (hl != null && !lit ? 0.4 : 1));
      put(textSprite(['I', 'II', 'III', 'IV'][i], "500 {px} 'STIX Two Text', serif", '#8f9aa6', l.f * 0.62), l.x - l.f * 0.5, l.y, l.f * 0.62, lawOn[i] * fade * 0.8, 1);
      const fi = i === 1 || i === 2 ? 0 : 1, t0 = 9.4 + i * 0.35;
      const fm = Lo.forms[fi], a = [l.x + eqW(k, l.f) + 8, l.y - l.f * 0.35], b = [fm.x - 8, fm.y - fm.f * 0.3];
      const prog = smooth((T - t0) / 0.9);
      if (prog > 0) ribbon(over, Lo.wide ? a : [l.x + eqW(k, l.f) / 2, l.y + l.f * 0.4], b, Lo.wide, 0, prog, withA(WHITE, 0.26 * fade), 1.4);
      const fly = (T - t0) / 1.0;
      if (fly > 0 && fly < 1) { const s = smooth(fly), p = bez(a, b, Lo.wide, s); put(eqSprite(k, l.f), p[0], p[1] + l.f * 0.35, l.f * lerp(1, 0.6, s), (1 - s) * 0.85 * fade); }
      formOn[fi] = Math.max(formOn[fi], smooth((T - t0 - 0.7) / 0.6));
    });
    Lo.asides.forEach((a, i) => put(eqSprite('law' + a.key, a.f), a.x, a.y, a.f, asideOn[i] * fade * 0.6));
    if (Lo.wide && Lo.asides.length) put(textSprite('material laws and continuity', SERIF, '#8f9aa6', Lo.asides[0].f * 0.8), Lo.asides[0].x, Lo.asides[0].y - Lo.asides[0].f * 1.5, Lo.asides[0].f * 0.8, Math.max(...asideOn) * fade * 0.8);
    ['lawdF', 'lawdsF'].forEach((k, i) => { const fm = Lo.forms[i]; put(eqSprite(k, fm.f), fm.x, fm.y, fm.f, formOn[i] * fade); });
    R.lines(SM, over.d, over.n, 'over');
  }

  // ── the field, flat ────────────────────────────────────────────────────
  function drawField(S, M, W, H, o = {}) {
    sheetAt(M, S, 0, { R: o.R || 9, alpha: o.alpha ?? 1, map: o.map, arrows: o.arrows ?? S.arrows, gauge: o.gauge, mapA: o.mapA, lineA: o.lineA, ringA: o.ringA });
    source(M, S, W, H, o.src || 1);
    if (o.labels === false) return;
    const k = F.kOf(S.lam), r1 = 1 / k;
    const a = project(M, [r1 * Math.cos(0.75), 0, r1 * Math.sin(0.75)], W, H);
    if (a) put(eqSprite('ikr1', 13), a[0] + 6, a[1] - 4, 13, 0.75 * (o.alpha ?? 1));
    for (let n = 1; n <= 3; n++) {
      const p = project(M, [n * S.lam * Math.cos(-0.5), 0, n * S.lam * Math.sin(-0.5)], W, H);
      if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) put(textSprite(n === 1 ? 'λ' : n + 'λ', SERIF, '#a8a4ff', 13), p[0] + 5, p[1] + 14, 13, 0.6 * (o.alpha ?? 1));
    }
  }

  // ── curl: three loops round the probe ───────────────────────────────────
  const ampCache = new Map();
  function curlAmp(which, P, k) {
    const id = which + P.map(v => v.toFixed(3)).join(',') + k.toFixed(4);
    if (ampCache.has(id)) return ampCache.get(id);
    let m = 1e-9;
    for (let i = 0; i < 24; i++) m = Math.max(m, Math.hypot(...F.curlFD(F.fieldFn(which, i / 24 * F.TAU / k, k), P, 1e-4)));
    if (ampCache.size > 64) ampCache.clear();
    ampCache.set(id, m);
    return m;
  }
  function fieldAmp(which, P, k) {
    const id = 'f' + which + P.map(v => v.toFixed(3)).join(',') + k.toFixed(4);
    if (ampCache.has(id)) return ampCache.get(id);
    const v = [0, 0, 0]; let m = 1e-9;
    for (let i = 0; i < 24; i++) { F.fieldFn(which, i / 24 * F.TAU / k, k)(...P, v); m = Math.max(m, Math.hypot(...v)); }
    ampCache.set(id, m);
    return m;
  }
  function drawCurl(S, M, W, H, which) {
    const k = F.kOf(S.lam), P = S.probe, t = S.t, hs = 0.11;
    const Ffn = F.fieldFn(which, t, k);
    const lc = F.curlFD(Ffn, P, 1e-4), h = 1e-3;
    const loops = [0, 1, 2].map(a => F.circulation(Ffn, P, a, h) / (h * h));
    const dE = [0, 0, 0], dB = [0, 0, 0];
    F.dEdt(P[0], P[1], P[2], t, k, dE, dB);
    const cmp = which === 'B' ? dE : dB.map(v => -v);
    readouts.curl = { which, lines: lc, loops, cmp };
    const amp = curlAmp(which, P, k), fcol = which === 'B' ? C.B : C.E, ccol = which === 'B' ? C.E : C.B;
    const eye = eyeOf(cam);
    // The sheet behind, dim.
    sheetAt(M, S, 0, { R: 3.2, alpha: 0.55, mapA: 0.4 });
    source(M, S, W, H, 0.8);
    over.clear(); overHeads.clear();
    const u = (((S.clock - (S.cycle0 || 0)) % 8) + 8) % 8 / 8;
    const Lsc = 0.3 / amp;
    // Loops, with beads that run round at a speed set by the circulation.
    for (let a = 0; a < 3; a++) {
      const [i, j] = F.PLANE[a], ei = E3[i], ej = E3[j];
      const corner = (s1, s2) => add3(P, add3(scl3(ei, s1 * hs), scl3(ej, s2 * hs)));
      const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const rel = clamp(Math.abs(lc[a]) / amp);
      const col = rel < 0.02 ? withA(DIM, 0.35) : withA(fcol, 0.35 + 0.6 * rel);
      over.poly(pts, col, 1.6, true);
      face(M, eye, P, E3[a], scl3(ei, hs), scl3(ej, hs), fcol.slice(0, 3), 0.05 + 0.18 * rel);
      // Arrowheads at the edge midpoints, in the direction of circulation.
      const dir = Math.sign(lc[a]) || 1;
      if (rel > 0.02) for (let e = 0; e < 4; e++) {
        const A = pts[e], B = pts[(e + 1) % 4], m = scl3(add3(A, B), 0.5), d = scl3(sub3(B, A), 0.08 * dir);
        overHeads.seg(add3(m, d), sub3(m, d), withA(fcol, 0.5 + 0.5 * rel), 6 + 6 * rel);
      }
      // Beads.
      if (rel > 0.02) for (let b = 0; b < 3; b++) {
        let s = ((S.clock * 0.25 * rel * dir + b / 3) % 1 + 1) % 1;
        const e = Math.floor(s * 4), f = s * 4 - e, A = pts[e], B = pts[(e + 1) % 4];
        const q = project(M, add3(A, scl3(sub3(B, A), f)), W, H);
        if (q) R.sprite(null, q[0] - 9, q[1] - 9, 18, 18, 0.7 * rel, 1, fcol);
      }
      const lab = project(M, corner(1.25, 1.25), W, H);
      if (lab) put(textSprite(['yz', 'zx', 'xy'][a], SERIF, '#c9d2dc', 14), lab[0], lab[1], 14, 0.85, 0.5);
    }
    // The field at the probe (dim), the component arrows, their sum, and
    // the comparison vector.
    const fv = Ffn(...P, [0, 0, 0]), fa = fieldAmp(which, P, k);
    arrow(over, overHeads, P, add3(P, scl3(fv, 0.18 / fa)), withA(fcol, 0.45), 1.4, 7);
    const comps = [0, 1, 2].map(a => scl3(E3[a], lc[a] * Lsc));
    const asm = smooth((u - 0.28) / 0.25), sumA = smooth((u - 0.55) / 0.12), cmpA = smooth((u - 0.68) / 0.12);
    let base = P.slice();
    for (let a = 0; a < 3; a++) {
      const start = add3(P, scl3(base.map((v, i) => v - P[i]), asm));
      const end = add3(start, comps[a]);
      if (Math.abs(lc[a]) / amp > 0.02) arrow(over, overHeads, start, end, withA(lerp3(fcol, WHITE, 0.35), 0.85 * (1 - 0.5 * sumA)), 1.8, 9);
      base = add3(base, comps[a]);
    }
    const sum = add3(P, scl3(lc, Lsc)), cm = add3(P, scl3(cmp, Lsc));
    if (cmpA > 0) arrow(over, overHeads, P, cm, withA(ccol, 0.55 * cmpA), 7, 18);
    if (sumA > 0) arrow(over, overHeads, P, sum, withA(lerp3(fcol, WHITE, 0.2), sumA), 2.6, 12);
    R.lines(M, over.d, over.n, 'over'); R.heads(M, overHeads.d, overHeads.n, 'over');
    const ts = project(M, sum, W, H), tc = project(M, cm, W, H);
    if (ts) put(eqSprite(which === 'B' ? 'lcurlB' : 'lcurlE', 16), ts[0] + 10, ts[1] - 6, 16, sumA);
    if (tc) put(eqSprite(which === 'B' ? 'ldispB' : 'lmdBdt', 15), tc[0] + 10, tc[1] + 22, 15, cmpA);
  }
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), a[3] ?? 1];

  // ── divergence: a small cube round the probe ────────────────────────────
  function drawDiv(S, M, W, H) {
    const which = S.divField || 'E', k = F.kOf(S.lam), P = S.probe, hs = 0.12;
    const Ffn = F.fieldFn(which, S.t, k), fcol = which === 'B' ? C.B : C.E;
    const J = F.jacobian(Ffn, P, 1e-4), h = 2e-3, fl = F.faceFlux(Ffn, P, h);
    readouts.div = { which, terms: [J[0][0], J[1][1], J[2][2]], pairs: [0, 1, 2].map(a => (fl[2 * a] + fl[2 * a + 1]) / h ** 3) };
    const fa = fieldAmp(which, P, k), eye = eyeOf(cam);
    sheetAt(M, S, 0, { R: 3.2, alpha: 0.5, mapA: 0.35 });
    source(M, S, W, H, 0.8);
    over.clear(); overHeads.clear();
    // Edges.
    const cn = (a, b, c) => add3(P, [a * hs, b * hs, c * hs]);
    const E = [[[-1, -1, -1], [1, -1, -1]], [[-1, 1, -1], [1, 1, -1]], [[-1, -1, 1], [1, -1, 1]], [[-1, 1, 1], [1, 1, 1]],
      [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
      [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]];
    for (const [a, b] of E) over.seg(cn(...a), cn(...b), withA(WHITE, 0.4), 1.3);
    // Faces and the flux arrows (out of the face, or into it).
    const v = [0, 0, 0];
    for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
      const [i, j] = F.PLANE[a], c = add3(P, scl3(E3[a], sg * hs));
      Ffn(...c, v);
      const out = sg * v[a] / fa, mag = clamp(Math.abs(out), 0, 1.5);
      face(M, eye, c, E3[a], scl3(E3[i], hs), scl3(E3[j], hs), fcol.slice(0, 3), 0.04 + 0.16 * clamp(mag));
      const L = 0.22 * mag, tip = add3(c, scl3(E3[a], sg * L));
      if (mag > 0.01) {
        if (out > 0) arrow(over, overHeads, c, tip, withA(fcol, 0.9), 2.2, 10);
        else arrow(over, overHeads, tip, c, withA(lerp3(fcol, [0.4, 0.45, 0.55], 0.45), 0.85), 2.2, 10);
      }
    }
    arrow(over, overHeads, P, add3(P, scl3(Ffn(...P, v), 0.16 / fa)), withA(lerp3(fcol, WHITE, 0.3), 0.7), 1.4, 7);
    R.lines(M, over.d, over.n, 'over'); R.heads(M, overHeads.d, overHeads.n, 'over');
    for (let a = 0; a < 3; a++) {
      const q = project(M, add3(P, scl3(E3[a], hs * 1.9)), W, H);
      if (q) put(textSprite('xyz'[a], SERIF, '#c9d2dc', 14), q[0], q[1], 14, 0.8, 0.5);
    }
  }

  // ── the field in 3D ────────────────────────────────────────────────────
  function drawFour(S, M, W, H) {
    const k = F.kOf(S.lam), eye = eyeOf(cam);
    for (const phi of [0, Math.PI / 2]) {
      const n = [-Math.sin(phi), Math.cos(phi), 0], v = norm3(sub3(eye, cam.target));
      const facing = Math.abs(n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
      sheetAt(M, S, phi, { R: 2.5, alpha: 0.25 + 0.6 * facing, mapA: 0.32, ringA: 0.5, map: 'none', lineA: 0.95 });
    }
    R.mesh(M, lobe, eye, [1.0, 0.9, 0.78], 0.5, 1.1, 0.05);
    lines.clear(); heads.clear();
    // Meridians and the equator of the lobe.
    for (let m = 0; m < 12; m++) {
      const ph = m / 12 * F.TAU, pts = [];
      for (let i = 0; i <= 40; i++) { const th = Math.PI * i / 40, r = LOBE * Math.sin(th) ** 2; pts.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]); }
      lines.poly(pts, [1, 0.9, 0.78, 0.1], 1);
    }
    // B rings round the axis, coloured by the sign of B_phi.
    const E = [0, 0, 0], B = [0, 0, 0];
    for (const z of [-0.9, -0.45, 0, 0.45, 0.9]) for (let i = 1; i <= 11; i++) {
      const rho = i * 0.2;
      F.EB(rho, 0, z, S.t, k, E, B);
      const r = Math.hypot(rho, z), val = B[1] / (k * k) * r, m = Math.tanh(Math.abs(val) * 1.3);
      if (m < 0.04) continue;
      const col = withA(val < 0 ? C.B : VIOLET, 0.12 + 0.6 * m), pts = [];
      for (let j = 0; j <= 64; j++) { const a = j / 64 * F.TAU; pts.push([rho * Math.cos(a), rho * Math.sin(a), z]); }
      lines.poly(pts, col, 1.1 + 1.2 * m);
      if (z === 0) for (const a0 of [0.6, 2.7, 4.8]) {
        const s = Math.sign(B[1]) || 1, p = [rho * Math.cos(a0), rho * Math.sin(a0), 0], d = [-Math.sin(a0) * s, Math.cos(a0) * s, 0];
        heads.seg(add3(p, scl3(d, 0.04)), sub3(p, scl3(d, 0.04)), col, 6 + 5 * m);
      }
    }
    lines.seg([0, 0, -2.6], [0, 0, 2.6], [0.9, 0.85, 0.9, 0.18], 1);
    R.lines(M, lines.d, lines.n, 'add'); R.heads(M, heads.d, heads.n, 'add');
    source(M, S, W, H, 0.9);
  }

  // ── gauge ──────────────────────────────────────────────────────────────
  const GC = [0.7, 0, 0.36], GW = 0.3;
  function drawGauge(S, M, W, H) {
    const g = S.gauge ?? 0.6, k = F.kOf(S.lam);
    drawField(S, M, W, H, { map: S.gaugeMap || 'Az', arrows: 2, gauge: [g, GC[0], GC[2], GW], mapA: 0.5, src: 0.9, labels: false, cell: 0.1 });
    over.clear();
    const pts = [];
    for (let i = 0; i <= 72; i++) { const a = i / 72 * F.TAU; pts.push([GC[0] + GW * Math.cos(a), 0, GC[2] + GW * Math.sin(a)]); }
    over.poly(pts, withA(C.A, 0.25 + 0.5 * g), 1.2, false, 7);
    R.lines(M, over.d, over.n, 'over');
    const q = project(M, [GC[0] + GW * 0.75, 0, GC[2] + GW * 0.85], W, H);
    if (q) put(eqSprite('ichi', 18), q[0], q[1], 18, 0.4 + 0.6 * g);
    // How much E and B change: E and B from the gauged potentials, against
    // the closed form (field.js), at three points round the blob.
    if (!S.gaugeCheckAt || S.clock - S.gaugeCheckAt > 0.25) {
      S.gaugeCheckAt = S.clock;
      let dE = 0, dB = 0, dA = 0, mE = 0;
      const E = [0, 0, 0], B = [0, 0, 0];
      for (const P of [[GC[0] + 0.1, 0.05, GC[2]], [GC[0] - 0.12, -0.04, GC[2] + 0.1], [GC[0], 0.1, GC[2] - 0.15]]) {
        const r = F.fromPotentials(P, S.t, (x, y, z, tt) => {
          const p = F.potentials(x, y, z, tt, k), G = F.gauge(x, y, z, tt, k, g * k, GC, GW);
          return [p[0] - G[4], p[1] + G[1], p[2] + G[2], p[3] + G[3]];
        });
        F.EB(...P, S.t, k, E, B);
        mE = Math.max(mE, Math.hypot(...E));
        dE = Math.max(dE, Math.hypot(r.E[0] - E[0], r.E[1] - E[1], r.E[2] - E[2]));
        dB = Math.max(dB, Math.hypot(r.B[0] - B[0], r.B[1] - B[1], r.B[2] - B[2]));
        const G = F.gauge(...P, S.t, k, g * k, GC, GW);
        dA = Math.max(dA, Math.hypot(G[1], G[2], G[3]));
      }
      readouts.gauge = { dE: dE / mE, dB: dB / mE, dA: dA / k, g };
    }
  }

  // ── forms: the boundary of a boundary ──────────────────────────────────
  function drawForms(S, M, W, H) {
    const P = S.probe, hs = 0.15, eye = eyeOf(cam);
    sheetAt(M, S, 0, { R: 3.2, alpha: 0.32, mapA: 0.3, lineA: 0.7 });
    source(M, S, W, H, 0.7);
    over.clear(); overHeads.clear();
    const u = (((S.clock - (S.cycle0 || 0)) % 9) + 9) % 9 / 9;
    const ins = lerp(0.55, 0.985, smooth(u / 0.45)), flash = smooth((u - 0.45) / 0.1) * (1 - smooth((u - 0.75) / 0.15));
    const cols = [C.E, C.B, C.A];
    for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
      const [i, j] = F.PLANE[a], c = add3(P, scl3(E3[a], sg * hs));
      face(M, eye, c, E3[a], scl3(E3[i], hs), scl3(E3[j], hs), [0.8, 0.85, 0.95], 0.06);
      // The loop, counterclockwise seen from outside.
      const q = (s1, s2) => add3(c, add3(scl3(E3[i], s1 * hs * ins), scl3(E3[j], s2 * hs * ins * sg)));
      const pts = [q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)];
      const col = withA(lerp3(cols[a], WHITE, 0.45), 0.85 * (1 - 0.7 * flash));
      over.poly(pts, col, 1.7, true);
      for (let e = 0; e < 4; e++) {
        const A = pts[e], B = pts[(e + 1) % 4], m = scl3(add3(A, B), 0.5), d = scl3(sub3(B, A), 0.09);
        overHeads.seg(add3(m, d), sub3(m, d), col, 9);
      }
    }
    // The edges: where two loops meet and cancel.
    if (flash > 0) {
      const cn = (a, b, c) => add3(P, [a * hs, b * hs, c * hs]);
      for (const [a, b] of [[[-1, -1, -1], [1, -1, -1]], [[-1, 1, -1], [1, 1, -1]], [[-1, -1, 1], [1, -1, 1]], [[-1, 1, 1], [1, 1, 1]],
        [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
        [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]]) over.seg(cn(...a), cn(...b), withA(WHITE, 0.9 * flash), 3);
    }
    R.lines(M, over.d, over.n, 'over'); R.heads(M, overHeads.d, overHeads.n, 'over');
    const t = project(M, add3(P, [0, 0, hs * 1.9]), W, H);
    if (t) put(eqSprite('dd0', 22), t[0], t[1], 22, 0.35 + 0.65 * flash, 0.5);
  }

  // ── frame ───────────────────────────────────────────────────────────────
  let lastNow = 0;
  function draw(S, now) {
    const W = R.W, H = R.H, dt = Math.min(0.1, Math.max(0, now - lastNow));
    lastNow = now;
    if (S.scene !== lastScene) { if (S.scene === 'fold') foldT0 = S.clock; lastScene = S.scene; }
    const band = bandOf(S, H);
    if (!S.view.held) { auto.phase += dt; auto.yaw += dt * 0.09; }
    easeCam(goal(S), dt, !camInit || S.snapCam);
    camInit = true; S.snapCam = false;
    const M = viewMatrix(cam, W, H, band);
    S.M = M;
    R.begin([0.02, 0.027, 0.04]);
    const sc = S.scene;
    if (sc === 'fold') { drawField(S, M, W, H, { alpha: 0.33, labels: false, src: 0.7 }); drawFold(S, W, H, band); }
    else if (sc === 'field') drawField(S, M, W, H);
    else if (sc === 'curlB') drawCurl(S, M, W, H, 'B');
    else if (sc === 'curlE') drawCurl(S, M, W, H, 'E');
    else if (sc === 'div') drawDiv(S, M, W, H);
    else if (sc === 'four') drawFour(S, M, W, H);
    else if (sc === 'gauge') drawGauge(S, M, W, H);
    else if (sc === 'forms') drawForms(S, M, W, H);
    if (S.fade != null && S.fade < 1) R.sprite(null, 0, 0, W, H, 1 - S.fade, 2, [0.02, 0.027, 0.04]);
  }

  // The world point on the sheet y = 0 under the CSS pixel (x, y), or null.
  function pick(S, x, y) {
    if (!S.M) return null;
    const inv = invert(S.M);
    if (!inv) return null;
    const nx = x / R.W * 2 - 1, ny = 1 - y / R.H * 2;
    const a = xform(inv, [nx, ny, -1, 1]), b = xform(inv, [nx, ny, 1, 1]);
    const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = sub3(p1, p0);
    if (Math.abs(d[1]) < 1e-9) return null;
    const s = -p0[1] / d[1];
    if (s < 0) return null;
    return add3(p0, scl3(d, s));
  }

  return {
    draw, pick, readouts, cam,
    restartFold(S) { foldT0 = S.clock; },
    foldLayout, eqW,
    fontsReady() { fontGen++; for (const [k, s] of [...cache]) if (k.startsWith('t|')) { R.dropTexture(s.tex); cache.delete(k); } },
    foldLength: FOLD_LEN,
  };
}

function xform(m, v) {
  return [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
}
// The inverse of a 4 × 4 column-major matrix (cofactors), or null.
export function invert(m) {
  const a = m, inv = new Float64Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
