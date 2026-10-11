// ============================================================================
//  FLY DUEL 3D  ·  the table scene  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  Two fruit flies sit on stools at a round wooden table and play the real
//  match. ui/match.js makes one record per decision. play(record) turns the
//  record into timed steps (ui/fly3d/choreo.js) and plays them: cards go
//  from the fan to the table, lands turn and dim when tapped, mana tokens
//  go from the lands to the card, creatures attack and block, damage
//  numbers rise, dead creatures go to the graveyard.
//
//  Look (FLY3D.md): crisp and well lit. One shadow light (the lamp over
//  the table), a cool rim light and a hemisphere fill. ACES tone mapping,
//  sRGB. No bloom, no blur, no fog.
//
//  World units: the table top is at y = TABLE.y, radius TABLE.r. Seat 0
//  (Fly A) sits at +z and looks to -z. Seat 1 (Fly B) sits at -z. Layout
//  numbers are in seat space (u = to the right of the seat as seen from
//  the centre, v = distance from the centre toward the seat). seatPos()
//  changes seat space to world space.
//
//  The fly. ui/fly3d/fly.js (another package) gives buildFly({ colour,
//  seed }) -> { root, rig, dispose } and animate(rig, clip, t, opts). Until
//  that file exists, a placeholder fly with the same API (in this file)
//  stands in. The scene loads fly.js with a dynamic import and changes to
//  it when the import works. The brain map (ui/fly3d/brain3d.js,
//  createBrainMap) loads the same way. Without it there is no map.
//
//  The brain map floats beside the head of its fly, not inside the head:
//  in a head capsule the map is too small to read at the wide shot, and it
//  would hide the eyes, which carry the character of the fly.
//
//  API
//      createDuelScene(canvas, { connectomes, cards, names, reduced,
//        coarse, headless }) -> { play(record) -> Promise, setState(state),
//        resize(), render(dt), dispose(), setSpeed(s), setCamera(mode),
//        shoot(shot, p), setBrains(on), ready, stats(), world }
//      setCamera: 'auto' (the steps pick the shots), 'wide', 'free' (the
//      user orbits, no cuts), 'script' (only shoot() cuts). Shots: wide,
//      over, close, combat, win.
//      canvas null or headless: true builds the scene graph without a
//      renderer (node tests).
//
//  GREP MAP
//      grep -n 'export const TABLE'           table and layout numbers
//      grep -n 'function seatPos'             seat space -> world
//      grep -n 'function drawFace'            card face (our own frame)
//      grep -n 'function drawBack'            card back
//      grep -n 'function cardGeometry'        chamfered card mesh
//      grep -n 'class CardObj'                one card on the table
//      grep -n 'function buildRoom'           floor, rug, walls, lamp
//      grep -n 'function buildTable'          table, felt, stools
//      grep -n 'function buildLights'         key, rim, fill
//      grep -n 'function placeholderBuildFly' stand-in fly
//      grep -n 'function placeholderAnimate'  stand-in clips
//      grep -n 'function layout'              where every card goes
//      grep -n 'const STEP'                   one handler per choreo op
//      grep -n 'function director'            camera shots
//      grep -n 'export function createDuelScene'
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CARD } from '../../game/cards.js';
import { cardArt, PALETTE, colourKey } from '../art.js';
import { TOKENS, FLY, SANS, MONO } from '../tokens.js';
import { choreograph, mirrorOf, applyStep, mirrorDiff } from './choreo.js';

// ------------------------------------------------------------ dimensions
export const TABLE = {
  r: 3.6, y: 2.0, thick: 0.12, felt: 3.3,
  cardW: 0.56, cardH: 0.784, cardT: 0.008,
  landV: 2.2, creatureV: 1.2, attackV: 0.48, rowHalf: 1.75,
  deckU: 2.35, deckV: 1.35, graveU: 2.35, graveV: 0.45,
  lifeU: -2.45, lifeV: 1.25,
  handV: 3.75, handY: 0.12, handR: 0.38,
  stageU: 0.7, stageV: 2.0, stageY: 1.0,
  seatV: 4.2, seatTop: 1.16,
  flyScale: 2.0, handScale: 0.78, fanR: 0.3,
};
const T = TABLE;
const YAW = [0, Math.PI];

// Seat space (u, y above the table top, v) -> world.
function seatPos(p, u, y, v, out = new THREE.Vector3()) {
  return p === 0 ? out.set(u, T.y + y, v) : out.set(-u, T.y + y, -v);
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
// Seat yaw, then local XYZ euler (radians).
function seatQuat(p, x = 0, y = 0, z = 0, out = new THREE.Quaternion()) {
  out.setFromEuler(_e.set(0, YAW[p], 0));
  return out.multiply(_q.setFromEuler(_e.set(x, y, z, 'YXZ')));
}

// --------------------------------------------------------- canvas utils
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
const HAS_PATH2D = typeof Path2D !== 'undefined';

function canvasTexture(cv, { srgb = true, aniso = 8 } = {}) {
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// The card shape: top corners cut at 45 degrees (chamfer = 10 % of the
// width), bottom corners round (DESIGN.md 3.1). Counter-clockwise points.
function cardOutline(W, H, arcSeg = 4) {
  const c = 0.1 * W, r = 0.036 * W, x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2;
  const pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= arcSeg; i++) { const a = a0 + (a1 - a0) * i / arcSeg; pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } };
  arc(x1 - r, y0 + r, -Math.PI / 2, 0);
  pts.push(new THREE.Vector2(x1, y1 - c), new THREE.Vector2(x1 - c, y1), new THREE.Vector2(x0 + c, y1), new THREE.Vector2(x0, y1 - c));
  arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return pts;
}
function cardPath(g, W, H) {
  const c = 0.1 * W, r = 0.036 * W;
  g.beginPath();
  g.moveTo(c, 0); g.lineTo(W - c, 0); g.lineTo(W, c); g.lineTo(W, H - r);
  g.arcTo(W, H, W - r, H, r); g.lineTo(r, H); g.arcTo(0, H, 0, H - r, r); g.lineTo(0, c); g.closePath();
}

// ------------------------------------------------------------ card face
// Logical card 168 x 235 (DESIGN.md 3.1), drawn at FACE_S times.
const FACE_W = 168, FACE_H = 235, FACE_S = 2;
const GLYPH = {
  amberHex: 'M10 1.5 17.4 5.75v8.5L10 18.5 2.6 14.25v-8.5z',
  amberDrop: 'M10 5.2c2.2 3 3.3 4.9 3.3 6.4a3.3 3.3 0 0 1-6.6 0c0-1.5 1.1-3.4 3.3-6.4z',
  mossTile: 'M10 1.2 18.8 10 10 18.8 1.2 10z',
  mossLeaf: 'M6.2 13.8C6.2 9.4 9.2 6.6 13.6 6.4c.2 4.4-2.7 7.3-7 7.4z',
  mossVein: 'M6.7 13.3 12.6 7.4',
};
// One mana glyph (the shapes of ui/art.js manaGlyph) at x, y, size px.
function drawGlyph(g, kind, x, y, size, n = 0) {
  g.save(); g.translate(x, y); g.scale(size / 20, size / 20);
  if (kind === 'amber' && HAS_PATH2D) {
    g.fillStyle = '#2b1604'; g.strokeStyle = TOKENS.amber; g.lineWidth = 1.6;
    const h = new Path2D(GLYPH.amberHex); g.fill(h); g.stroke(h);
    g.fillStyle = TOKENS.amber; g.fill(new Path2D(GLYPH.amberDrop));
    g.fillStyle = '#fff3d0'; g.fillRect(8.2, 10.8, 1.3, 1.3);
  } else if (kind === 'moss' && HAS_PATH2D) {
    g.fillStyle = '#14260a'; g.strokeStyle = TOKENS.moss; g.lineWidth = 1.4; g.lineJoin = 'round';
    const d = new Path2D(GLYPH.mossTile); g.fill(d); g.stroke(d);
    g.fillStyle = TOKENS.moss; g.fill(new Path2D(GLYPH.mossLeaf));
    g.strokeStyle = '#14260a'; g.lineWidth = 1; g.lineCap = 'round'; g.stroke(new Path2D(GLYPH.mossVein));
  } else {
    g.fillStyle = TOKENS.panel2; g.strokeStyle = TOKENS.none; g.lineWidth = 1.4;
    g.beginPath(); g.roundRect ? g.roundRect(2, 2, 16, 16, 3.5) : g.rect(2, 2, 16, 16); g.fill(); g.stroke();
    g.fillStyle = TOKENS.ink; g.font = `600 11px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(String(n | 0), 10, 14);
  }
  g.restore();
}

// Keyword icons, 16 px box, 1.5 px stroke (DESIGN.md 3.3).
function drawKeyword(g, kw, x, y, s, col) {
  g.save(); g.translate(x, y); g.scale(s / 16, s / 16);
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5; g.lineCap = 'square'; g.lineJoin = 'miter';
  g.beginPath();
  if (kw === 'swift') { g.moveTo(3, 3); g.lineTo(8, 8); g.lineTo(3, 13); g.moveTo(8, 3); g.lineTo(13, 8); g.lineTo(8, 13); g.stroke(); }
  else if (kw === 'wings') { g.moveTo(2, 13); g.quadraticCurveTo(4, 2, 14, 3); g.quadraticCurveTo(12, 11, 2, 13); g.moveTo(3, 12); g.lineTo(11, 5); g.moveTo(6, 11); g.lineTo(12, 8); g.stroke(); }
  else if (kw === 'sting') { g.moveTo(8, 1); g.lineTo(11, 11); g.lineTo(5, 11); g.closePath(); g.stroke(); g.beginPath(); g.arc(8, 13.5, 1.8, 0, Math.PI * 2); g.fill(); }
  else if (kw === 'thick') { for (const yy of [4, 8, 12]) { g.moveTo(2, yy); g.lineTo(14, yy); } g.stroke(); }
  else if (kw === 'sap') { g.moveTo(8, 1.5); g.bezierCurveTo(12, 7, 13, 9, 13, 10.5); g.arc(8, 10.5, 5, 0, Math.PI); g.bezierCurveTo(3, 9, 4, 7, 8, 1.5); g.stroke(); g.beginPath(); g.moveTo(8, 7.5); g.lineTo(8, 13); g.moveTo(5.3, 10.3); g.lineTo(10.7, 10.3); g.stroke(); }
  g.restore();
}

function wrapText(g, text, x, y, maxW, lh, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(test).width > maxW && line) {
      if (n === maxLines - 1) { g.fillText(line + '…', x, y + n * lh); return n + 1; }
      g.fillText(line, x, y + n * lh); n++; line = words[i];
    } else line = test;
  }
  if (line) { g.fillText(line, x, y + n * lh); n++; }
  return n;
}

// The face of one card. Our own frame (DESIGN.md 3.1, 3.6): cost rail on
// the left, name band with the colour bar, art window, type line with
// keyword icons, rules text, stat plate bottom left. Lands show a large
// mana glyph, so mana reads from far away.
function drawFace(g, card, art) {
  const W = FACE_W, H = FACE_H, P = PALETTE[colourKey(card.colour)];
  g.save();
  g.clearRect(0, 0, W, H);
  cardPath(g, W, H); g.save(); g.clip();
  g.fillStyle = TOKENS.panel2; g.fillRect(0, 0, W, H);
  g.fillStyle = P.ink; g.fillRect(0, 0, W, 4);                       // colour bar
  // name
  g.fillStyle = TOKENS.ink; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  let fs = 13; g.font = `600 ${fs}px ${SANS}`;
  while (g.measureText(card.name).width > W - 34 && fs > 9) { fs -= 0.5; g.font = `600 ${fs}px ${SANS}`; }
  g.fillText(card.name, 22, 21);
  // cost rail
  const cost = card.cost || {};
  let gy = 30;
  if (cost.generic > 0) { drawGlyph(g, 'generic', 3, gy, 18, cost.generic); gy += 20; }
  for (let i = 0; i < (cost.amber | 0); i++) { drawGlyph(g, 'amber', 3, gy, 18); gy += 20; }
  for (let i = 0; i < (cost.moss | 0); i++) { drawGlyph(g, 'moss', 3, gy, 18); gy += 20; }
  // art window
  const ax = 26, ay = 28, aw = W - 32, ah = Math.round(aw * 0.7);
  g.fillStyle = P.sky0; g.fillRect(ax, ay, aw, ah);
  if (art) g.drawImage(art, ax, ay, aw, ah);
  g.strokeStyle = TOKENS.hair2; g.lineWidth = 1; g.strokeRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1);
  // type line
  const ty = ay + ah + 16;
  g.fillStyle = TOKENS.dim; g.font = `500 10.5px ${SANS}`;
  g.fillText(card.type === 'creature' ? (card.token ? 'Creature token' : 'Creature') : card.type === 'land' ? 'Land' : 'Spell', 8, ty);
  let kx = W - 8;
  for (const kw of (card.keywords || []).slice().reverse()) { kx -= 15; drawKeyword(g, kw, kx, ty - 11, 13, TOKENS.ink2); }
  g.fillStyle = TOKENS.hair; g.fillRect(6, ty + 5, W - 12, 1);
  // text box
  if (card.type === 'land') {
    const kind = card.produces === 'amber' ? 'amber' : 'moss';
    drawGlyph(g, kind, W / 2 - 22, ty + 12, 44);
    g.fillStyle = P.ink; g.font = `600 12px ${MONO}`; g.textAlign = 'center';
    g.fillText(`+1 ${kind}`, W / 2, H - 10);
    g.textAlign = 'left';
  } else {
    g.fillStyle = TOKENS.ink2; g.font = `400 11px ${SANS}`;
    const n = card.text ? wrapText(g, card.text, 8, ty + 20, W - 16, 13.5, 3) : 0;
    if (card.flavour && n < 2) { g.fillStyle = TOKENS.dim; g.font = `italic 400 10px ${SANS}`; wrapText(g, card.flavour, 8, ty + 20 + n * 13.5 + 2, W - 16, 12.5, 2 - n || 1); }
  }
  // stat plate (creatures), bottom left
  if (card.type === 'creature') {
    const sx = 6, sy = H - 30, sw = 64, sh = 24;
    g.fillStyle = TOKENS.panel; g.fillRect(sx, sy, sw, sh);
    g.strokeStyle = P.ink; g.lineWidth = 1; g.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    g.fillRect(sx + sw / 2, sy + 3, 1, sh - 6);
    g.fillStyle = TOKENS.ink; g.font = `700 17px ${MONO}`; g.textAlign = 'center';
    g.fillText(String(card.power ?? 0), sx + sw / 4 + 3, sy + 18);
    g.fillText(String(card.toughness ?? 0), sx + (3 * sw) / 4 + 3, sy + 18);
    // mandible (power) and shell arc (toughness) marks
    g.strokeStyle = TOKENS.dim; g.lineWidth = 1.2; g.beginPath();
    g.moveTo(sx + 5, sy + 7); g.quadraticCurveTo(sx + 9, sy + 12, sx + 6, sy + 17);
    g.moveTo(sx + sw / 2 + 5, sy + 16); g.arc(sx + sw / 2 + 8, sy + 16, 3.5, Math.PI, 0); g.stroke();
    g.textAlign = 'left';
  }
  g.restore();
  // 1 px border in the card colour
  cardPath(g, W, H); g.strokeStyle = P.ink; g.lineWidth = 2; g.stroke();
  g.restore();
}

// Card back (DESIGN.md 3.6): honeycomb grid, one wing outline.
function drawBack(g) {
  const W = FACE_W, H = FACE_H;
  cardPath(g, W, H); g.save(); g.clip();
  g.fillStyle = TOKENS.panel2; g.fillRect(0, 0, W, H);
  g.strokeStyle = TOKENS.faint; g.lineWidth = 1;
  const cw = W / 6, rh = H / 9, rr = Math.min(cw, rh) * 0.5;
  for (let j = 0; j <= 9; j++) for (let i = 0; i <= 6; i++) {
    const cx = i * cw + (j % 2 ? cw / 2 : 0), cy = j * rh + rh / 2;
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g[k ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    g.closePath(); g.stroke();
  }
  g.strokeStyle = TOKENS.dim; g.lineWidth = 2; g.beginPath();
  g.moveTo(30, 170); g.bezierCurveTo(40, 80, 110, 50, 146, 62); g.bezierCurveTo(140, 120, 90, 160, 30, 170);
  g.moveTo(34, 165); g.lineTo(120, 80); g.moveTo(60, 158); g.lineTo(132, 104); g.moveTo(50, 120); g.lineTo(96, 70);
  g.stroke();
  g.restore();
  cardPath(g, W, H); g.strokeStyle = TOKENS.hair2; g.lineWidth = 2; g.stroke();
}

// --------------------------------------------------------- texture cache
function textureCache() {
  const faces = new Map();
  let back = null;
  const all = [];
  function face(id) {
    if (faces.has(id)) return faces.get(id);
    const card = CARD[id] || { id, name: id, type: 'spell', colour: 'none', cost: {} };
    const cv = makeCanvas(FACE_W * FACE_S, FACE_H * FACE_S);
    let tex = null;
    if (cv && cv.getContext) {
      const g = cv.getContext('2d');
      const entry = { cv, g, card, art: null };
      const paint = () => { g.setTransform(FACE_S, 0, 0, FACE_S, 0, 0); drawFace(g, card, entry.art); if (tex) tex.needsUpdate = true; };
      paint();
      tex = canvasTexture(cv);
      tex.userData.repaint = paint;
      // the art: our own SVG from ui/art.js, drawn when the image loads
      if (typeof Image !== 'undefined') {
        const svg = cardArt(card).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" ');
        const img = new Image();
        img.onload = () => { entry.art = img; paint(); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      }
      all.push(tex);
    }
    faces.set(id, tex);
    return tex;
  }
  function backTex() {
    if (back !== null) return back;
    const cv = makeCanvas(FACE_W * FACE_S, FACE_H * FACE_S);
    if (cv && cv.getContext) { const g = cv.getContext('2d'); g.setTransform(FACE_S, 0, 0, FACE_S, 0, 0); drawBack(g); back = canvasTexture(cv); all.push(back); }
    else back = undefined;
    return back;
  }
  // Fonts load late: paint every face again when they are ready.
  if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(() => { for (const t of all) t.userData.repaint?.(); });
  return { face, back: backTex, dispose() { for (const t of all) t.dispose(); faces.clear(); } };
}

// Text on a sprite (damage numbers, banners). Crisp: a dark outline, no
// glow. Cached by text and colour.
function spriteFactory() {
  const cache = new Map();
  function tex(text, colour, { size = 64, pad = 18, panel = false } = {}) {
    const key = `${text}|${colour}|${size}|${panel}`;
    if (cache.has(key)) return cache.get(key);
    const font = `700 ${size}px ${panel ? SANS : MONO}`;
    let cv = makeCanvas(8, 8), w = 8, h = 8, t = null;
    if (cv && cv.getContext) {
      let g = cv.getContext('2d'); g.font = font;
      w = Math.ceil(g.measureText(text).width + pad * 2); h = Math.ceil(size * 1.45);
      cv.width = w; cv.height = h; g = cv.getContext('2d'); g.font = font;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (panel) {
        g.fillStyle = TOKENS.panel; g.strokeStyle = colour; g.lineWidth = 3;
        g.beginPath(); g.roundRect ? g.roundRect(1.5, 1.5, w - 3, h - 3, 10) : g.rect(1.5, 1.5, w - 3, h - 3); g.fill(); g.stroke();
        g.fillStyle = TOKENS.ink; g.fillText(text, w / 2, h / 2 + 2);
      } else {
        g.lineJoin = 'round'; g.lineWidth = size * 0.16; g.strokeStyle = TOKENS.bg; g.strokeText(text, w / 2, h / 2);
        g.fillStyle = colour; g.fillText(text, w / 2, h / 2);
      }
      t = canvasTexture(cv, { aniso: 1 });
    }
    const out = { tex: t, aspect: w / h };
    cache.set(key, out);
    return out;
  }
  function make(text, colour, height = 0.3, o = {}) {
    const { tex: t, aspect } = tex(text, colour, o);
    const mat = new THREE.SpriteMaterial({ map: t, color: t ? 0xffffff : new THREE.Color(colour), depthTest: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.scale.set(height * aspect, height, 1);
    s.renderOrder = 10;
    return s;
  }
  return { make, dispose() { for (const v of cache.values()) v.tex?.dispose(); cache.clear(); } };
}

// ----------------------------------------------------------- card mesh
// One BufferGeometry: front cap (group 0), back cap (group 1), edge
// (group 2). The back UVs are mirrored so the back reads the right way.
function cardGeometry(W = T.cardW, H = T.cardH, D = T.cardT) {
  const pts = cardOutline(W, H);
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = [], nor = [], uv = [], idx = [];
  const n = pts.length;
  const x0 = -W / 2, y0 = -H / 2;
  // front
  for (const p of pts) { pos.push(p.x, p.y, D / 2); nor.push(0, 0, 1); uv.push((p.x - x0) / W, (p.y - y0) / H); }
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const nf = idx.length;
  // back
  for (const p of pts) { pos.push(p.x, p.y, -D / 2); nor.push(0, 0, -1); uv.push(1 - (p.x - x0) / W, (p.y - y0) / H); }
  for (const t of tris) idx.push(n + t[0], n + t[2], n + t[1]);
  const nb = idx.length - nf;
  // edge
  const base = 2 * n;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = dy / l, ny = -dx / l;
    const k = base + i * 4;
    pos.push(a.x, a.y, D / 2, b.x, b.y, D / 2, b.x, b.y, -D / 2, a.x, a.y, -D / 2);
    for (let j = 0; j < 4; j++) { nor.push(nx, ny, 0); uv.push(0, 0); }
    idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, nf, 0); g.addGroup(nf, nb, 1); g.addGroup(nf + nb, idx.length - nf - nb, 2);
  return g;
}

// An outline ring just outside the card (attack, block, target marks).
function ringGeometry(W = T.cardW, H = T.cardH, w = 0.035) {
  const outer = cardOutline(W + 2 * w, H + 2 * w), inner = cardOutline(W, H);
  const s = new THREE.Shape(outer);
  s.holes.push(new THREE.Path(inner.slice().reverse()));
  return new THREE.ShapeGeometry(s);
}

const easeOut = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeIO = t => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// One card on the table. It moves toward its target with an arc.
class CardObj {
  constructor(W, id) {
    this.W = W; this.id = id; this.uid = null;
    const face = W.tex.face(id);
    this.front = new THREE.MeshStandardMaterial({
      map: face || null, color: face ? 0xffffff : new THREE.Color(PALETTE[colourKey(CARD[id]?.colour)].ink),
      roughness: 0.58, metalness: 0, emissive: 0xffffff, emissiveMap: face || null, emissiveIntensity: 0,
    });
    this.mesh = new THREE.Mesh(W.cardGeo, [this.front, W.backMat, W.edgeMat]);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.userData.card = id;
    this.ring = new THREE.Mesh(W.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.ring.position.z = -T.cardT / 2 - 0.002; this.ring.visible = false;
    this.mesh.add(this.ring);
    this.badge = null; this.badgeKey = '';
    this.fromP = new THREE.Vector3(); this.fromQ = new THREE.Quaternion();
    this.toP = new THREE.Vector3(); this.toQ = new THREE.Quaternion();
    this.t = 1; this.dur = 0; this.arc = 0;
    this.next = null;                 // { dur, arc } for the next move
    this.dim = 1; this.dimTo = 1; this.glow = 0; this.glowTo = 0;
    this.scale = 1; this.scaleTo = 1;
    this.lunge = null;                // { dir: Vector3, t, dur }
    this.pulse = 0;
    W.cards.add(this.mesh);
  }
  place(p, q) { this.mesh.position.copy(p); this.mesh.quaternion.copy(q); this.toP.copy(p); this.toQ.copy(q); this.t = 1; this.dur = 0; }
  // Move toward p, q. A zone change (this.next) always starts a new arc.
  // follow: a small change of the target (a fan that moves with the
  // fly's hand) changes the end point and does not start a new move.
  target(p, q, dur = 0.35, arc = 0, follow = false) {
    let delay = 0;
    const d2 = this.toP.distanceToSquared(p), dq = Math.abs(this.toQ.dot(q));
    if (this.next) { ({ dur, arc } = this.next); delay = this.next.delay || 0; this.next = null; }
    else {
      if (d2 < 1e-8 && dq > 0.999999) return;
      if (follow && d2 < 0.0025 && dq > 0.9995) { this.toP.copy(p); this.toQ.copy(q); return; }
    }
    this.fromP.copy(this.basePos ?? this.mesh.position); this.fromQ.copy(this.mesh.quaternion);
    this.toP.copy(p); this.toQ.copy(q);
    this.t = 0; this.dur = this.W.reduced ? 0 : Math.max(0, dur); this.arc = arc;
    this.delay = this.W.reduced ? 0 : delay;
  }
  update(dt) {
    const m = this.mesh;
    if (this.delay > 0) { this.delay -= dt; dt = this.delay < 0 ? -this.delay : 0; if (this.delay < 0) this.delay = 0; }
    if (this.delay > 0) { /* wait at the start pose */ }
    else if (this.t < 1) {
      this.t = this.dur > 0 ? Math.min(1, this.t + dt / this.dur) : 1;
      const e = easeIO(this.t);
      m.position.lerpVectors(this.fromP, this.toP, e);
      m.position.y += this.arc * 4 * e * (1 - e);
      m.quaternion.slerpQuaternions(this.fromQ, this.toQ, e);
    } else { m.position.copy(this.toP); m.quaternion.copy(this.toQ); }
    this.basePos = this.basePos || new THREE.Vector3();
    this.basePos.copy(m.position);
    if (this.lunge) {
      const L = this.lunge; L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      m.position.addScaledVector(L.dir, Math.sin(Math.PI * k) * L.len);
      if (k >= 1) this.lunge = null;
    }
    const a = 1 - Math.exp(-dt * 14);
    this.dim += (this.dimTo - this.dim) * a;
    this.glow += (this.glowTo - this.glow) * a;
    this.scale += (this.scaleTo - this.scale) * a;
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.2);
    const s = this.scale * (1 + 0.12 * Math.sin(Math.PI * this.pulse));
    m.scale.setScalar(s);
    this.front.color.setScalar(this.dim);
    this.front.emissiveIntensity = this.glow;
  }
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.front.dispose(); this.ring.material.dispose();
    if (this.badge) { this.badge.material.map?.dispose(); this.badge.material.dispose(); }
  }
}

// --------------------------------------------------------- wood and felt
function woodCanvas(size, { rings = true, base = '#6b3f22', dark = '#4a2a15', light = '#8a5630', planks = 0, seed = 7 } = {}) {
  const cv = makeCanvas(size, size);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d');
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  if (rings) {
    const c = size / 2;
    for (let i = 0; i < 70; i++) {
      const rr = (i / 70) * c * 1.42 + r() * 4;
      g.strokeStyle = i % 3 ? dark : light; g.globalAlpha = 0.18 + r() * 0.2; g.lineWidth = 1 + r() * 2.5;
      g.beginPath();
      for (let k = 0; k <= 96; k++) { const a = (k / 96) * Math.PI * 2, w = rr + Math.sin(a * 3 + i) * 3 + Math.sin(a * 7 + i * 0.3) * 1.5; g[k ? 'lineTo' : 'moveTo'](c + Math.cos(a) * w, c + Math.sin(a) * w); }
      g.stroke();
    }
  }
  if (planks) {
    const pw = size / planks;
    for (let i = 0; i < planks; i++) {
      g.globalAlpha = 0.25; g.fillStyle = i % 2 ? light : dark; g.fillRect(i * pw, 0, pw, size);
      g.globalAlpha = 0.9; g.fillStyle = '#1a0f08'; g.fillRect(i * pw, 0, 2, size);
      for (let k = 0; k < 26; k++) { g.globalAlpha = 0.12 + r() * 0.12; g.strokeStyle = dark; g.lineWidth = 1 + r() * 2; const x = i * pw + r() * pw; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 20, size * 0.3, x + (r() - 0.5) * 20, size * 0.7, x + (r() - 0.5) * 10, size); g.stroke(); }
      const cut = r() * size; g.globalAlpha = 0.9; g.fillStyle = '#1a0f08'; g.fillRect(i * pw, cut, pw, 2);
    }
  }
  g.globalAlpha = 1;
  return cv;
}

// The felt play mat: hairline zones per seat, in the seat colour.
function feltCanvas(size) {
  const cv = makeCanvas(size, size);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d');
  g.fillStyle = '#16302c'; g.fillRect(0, 0, size, size);
  // fine weave
  g.globalAlpha = 0.07; g.strokeStyle = '#000';
  for (let i = 0; i < size; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke(); }
  g.globalAlpha = 1;
  const k = size / (2 * T.felt), c = size / 2;
  // world (x, z) -> canvas column, row (see buildTable)
  const toC = (x, z) => [c + x * k, c + z * k];
  g.lineWidth = 2; g.font = `600 ${Math.round(size * 0.016)}px ${SANS}`; g.textAlign = 'center';
  for (let p = 0; p < 2; p++) {
    const col = FLY[p], sg = p === 0 ? 1 : -1;
    g.strokeStyle = col; g.fillStyle = col; g.globalAlpha = 0.38;
    const zone = (u0, u1, v0, v1, label) => {
      const a = toC(sg * u0, sg * v0), b = toC(sg * u1, sg * v1);
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      g.setLineDash([10, 8]); g.strokeRect(x, y, w, h); g.setLineDash([]);
      if (label) {
        g.save(); g.globalAlpha = 0.5;
        const [lx, ly] = toC(sg * (u0 + u1) / 2, sg * (v1 + 0.08));
        g.translate(lx, ly); if (p === 1) g.rotate(Math.PI);
        g.fillText(label, 0, size * 0.006); g.restore();
      }
    };
    zone(-T.rowHalf - 0.4, T.rowHalf + 0.4, T.landV - 0.48, T.landV + 0.46, 'LANDS · MANA');
    zone(-T.rowHalf - 0.4, T.rowHalf + 0.4, T.creatureV - 0.48, T.creatureV + 0.46, 'CREATURES');
  }
  g.globalAlpha = 0.5; g.strokeStyle = TOKENS.ink2; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(toC(-T.felt, 0)[0], c); g.lineTo(toC(T.felt, 0)[0], c); g.stroke();
  g.globalAlpha = 1;
  return cv;
}

function rugCanvas(size) {
  const cv = makeCanvas(size, size);
  if (!cv?.getContext) return null;
  const g = cv.getContext('2d'), c = size / 2;
  const bands = ['#2a1a2e', '#3b2337', '#5b2f3a', '#7a4a2e', '#3b2337', '#24324a', '#1e2638'];
  for (let i = 0; i < bands.length; i++) { g.fillStyle = bands[i]; g.beginPath(); g.arc(c, c, c * (1 - i * 0.11), 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#c99a5b'; g.globalAlpha = 0.55; g.lineWidth = 3;
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.62, c + Math.sin(a) * c * 0.62); g.lineTo(c + Math.cos(a + 0.13) * c * 0.78, c + Math.sin(a + 0.13) * c * 0.78); g.lineTo(c + Math.cos(a + 0.26) * c * 0.62, c + Math.sin(a + 0.26) * c * 0.62); g.stroke(); }
  g.globalAlpha = 1;
  return cv;
}

// ------------------------------------------------------------- the room
function buildRoom(W) {
  const room = new THREE.Group(); room.name = 'room';
  const floorTex = canvasTexture(woodCanvas(1024, { rings: false, planks: 8, base: '#3a2416', dark: '#24150c', light: '#4c3020', seed: 3 }));
  if (floorTex) { floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(4, 4); }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(22, 48), new THREE.MeshStandardMaterial({ map: floorTex, color: floorTex ? 0xffffff : 0x3a2416, roughness: 0.82 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
  const rugTex = canvasTexture(rugCanvas(1024));
  const rug = new THREE.Mesh(new THREE.CircleGeometry(6.4, 64), new THREE.MeshStandardMaterial({ map: rugTex, color: rugTex ? 0xffffff : 0x3b2337, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.01; rug.receiveShadow = true; room.add(rug);
  // walls: a dark panelled cylinder with a lighter wainscot rail
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 12, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.92, side: THREE.BackSide }));
  wall.position.y = 6; room.add(wall);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(15.9, 15.9, 0.18, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6, side: THREE.BackSide }));
  rail.position.y = 3.2; room.add(rail);
  const wains = new THREE.Mesh(new THREE.CylinderGeometry(15.95, 15.95, 3.1, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.8, side: THREE.BackSide }));
  wains.position.y = 1.55; room.add(wains);
  // the lamp over the table: cord, brass shade, bulb
  const lampY = T.y + 5.0;
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.25, 0.75, 40, 1, true), brass);
  shade.position.y = lampY; room.add(shade);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 0.16, 24), brass); cap.position.y = lampY + 0.44; room.add(cap);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 7, 6), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
  cord.position.y = lampY + 4; room.add(cord);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 2.2 }));
  bulb.position.y = lampY - 0.18; room.add(bulb);
  W.lampY = lampY;
  return room;
}

// ---------------------------------------------------- table and stools
function buildTable(W) {
  const g = new THREE.Group(); g.name = 'table';
  const woodTex = canvasTexture(woodCanvas(1024, { seed: 11 }));
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: woodTex ? 0xffffff : 0x6b3f22, roughness: 0.48, metalness: 0 });
  const woodPlain = new THREE.MeshStandardMaterial({ color: 0x5a331b, roughness: 0.5 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(T.r, T.r, T.thick, 96), [woodPlain, wood, woodPlain]);
  top.position.y = T.y - T.thick / 2; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(T.r, 0.06, 10, 96), woodPlain);
  lip.rotation.x = Math.PI / 2; lip.position.y = T.y - 0.03; g.add(lip);
  const feltTex = canvasTexture(feltCanvas(2048));
  const felt = new THREE.Mesh(new THREE.CircleGeometry(T.felt, 96), new THREE.MeshStandardMaterial({ map: feltTex, color: feltTex ? 0xffffff : 0x16302c, roughness: 0.95 }));
  // CircleGeometry uv: u = x, v = y. Laid flat with rotation.x = -PI/2,
  // local y becomes world -z. With flipY the canvas row grows with world
  // z, and the canvas reads the right way from seat 0.
  felt.rotation.x = -Math.PI / 2; felt.position.y = T.y + 0.002; felt.receiveShadow = true;
  g.add(felt);
  // seat inlays: an arc of the seat colour at the table edge, bright when
  // that seat is to act.
  W.inlay = [0, 1].map(p => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(FLY[p]) });
    const arc = new THREE.Mesh(new THREE.RingGeometry(T.felt + 0.04, T.felt + 0.16, 64, 1, 0, Math.PI * 0.56), m);
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = (p === 0 ? -Math.PI / 2 : Math.PI / 2) - Math.PI * 0.28;
    arc.position.y = T.y + 0.003;
    g.add(arc);
    return m;
  });
  // pedestal: lathe column and four feet
  const prof = [[0.0, 0], [0.9, 0], [0.9, 0.12], [0.4, 0.22], [0.28, 0.5], [0.34, 0.9], [0.22, 1.3], [0.3, 1.7], [0.6, T.y - T.thick - 0.02], [0, T.y - T.thick - 0.02]].map(([x, y]) => new THREE.Vector2(x, y));
  const col = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), woodPlain); col.castShadow = true; col.receiveShadow = true; g.add(col);
  // stools
  W.stools = [0, 1].map(p => {
    const s = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.74, 0.14, 40), wood); seat.position.y = T.seatTop - 0.07; seat.castShadow = seat.receiveShadow = true; s.add(seat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 32), woodPlain); ring.rotation.x = Math.PI / 2; ring.position.y = T.seatTop * 0.4; s.add(ring);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, T.seatTop, 10), woodPlain);
      leg.position.set(Math.cos(a) * 0.55, T.seatTop / 2 - 0.07, Math.sin(a) * 0.55);
      leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
      leg.castShadow = true; s.add(leg);
    }
    // seat badge: a thin band in the seat colour
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.785, 0.785, 0.04, 40, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(FLY[p]) }));
    band.position.y = T.seatTop - 0.1; s.add(band);
    s.position.copy(seatPos(p, 0, 0, T.seatV)); s.position.y = 0;
    g.add(s);
    return s;
  });
  return g;
}

// Life counter: a drum in the seat colour. The number is on the drum
// four times, so it reads from every side. On a change the drum turns a
// quarter turn, and the number shows red (loss) or green (gain) for a
// short time.
function buildLifeDrum(W, p) {
  const cv = makeCanvas(1024, 256);
  const tex = canvasTexture(cv, { aniso: 4 });
  const side = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x111623, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: tex ? 0.35 : 0 });
  const capM = new THREE.MeshStandardMaterial({ color: new THREE.Color(FLY[p]), roughness: 0.4 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.42, 48), [side, capM, capM]);
  drum.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 48), new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.5, metalness: 0.3 }));
  const grp = new THREE.Group(); grp.add(base); base.position.y = 0.04; grp.add(drum); drum.position.y = 0.08 + 0.21;
  grp.position.copy(seatPos(p, T.lifeU, 0, T.lifeV));
  const st = { grp, drum, tex, cv, value: null, flash: 0, flashCol: TOKENS.ink, spin: 0, spinTo: 0 };
  st.draw = (v, col) => {
    if (!cv?.getContext) return;
    const g = cv.getContext('2d');
    g.fillStyle = TOKENS.panel2; g.fillRect(0, 0, 1024, 256);
    for (let k = 0; k < 4; k++) {
      const x = k * 256;
      g.fillStyle = FLY[p]; g.fillRect(x, 0, 256, 18); g.fillRect(x, 238, 256, 18);
      g.fillStyle = col; g.font = `700 150px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(v), x + 128, 134);
      g.fillStyle = TOKENS.ink2; g.font = `600 26px ${SANS}`; g.textAlign = 'left';
      g.fillText(p ? 'B' : 'A', x + 12, 46);
      g.fillStyle = TOKENS.hair2; g.fillRect(x + 255, 18, 1, 220);
    }
    if (tex) tex.needsUpdate = true;
  };
  return st;
}

// --------------------------------------------------------- mana tokens
function tokenGeos() {
  return {
    amber: new THREE.CylinderGeometry(0.1, 0.1, 0.05, 6),      // honeycomb cell
    moss: new THREE.CylinderGeometry(0.115, 0.115, 0.05, 4),   // diamond tile
    generic: new THREE.BoxGeometry(0.16, 0.05, 0.16),          // grey square
  };
}
function tokenMats() {
  const m = (c, e) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), emissive: new THREE.Color(c), emissiveIntensity: e, roughness: 0.35, metalness: 0.1 });
  return { amber: m(TOKENS.amber, 0.55), moss: m(TOKENS.moss, 0.5), generic: m(TOKENS.none, 0.35) };
}

// ======================================================== placeholder fly
// Stand-in with the API of ui/fly3d/fly.js. Origin at the seat, +y up, +z
// forward (toward the table). About TABLE.flyH tall.
function placeholderBuildFly({ colour = '#39d0f0', seed = 1, detail = 'high' } = {}) {
  const root = new THREE.Group(); root.name = 'fly-placeholder';
  const tan = new THREE.MeshStandardMaterial({ color: 0xc8954e, roughness: 0.55 });
  const ochre = new THREE.MeshStandardMaterial({ color: 0xa8732f, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 });
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xa3242a, roughness: 0.28, metalness: 0.05 });
  const wingM = new THREE.MeshPhysicalMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.32, roughness: 0.12, iridescence: 1, iridescenceIOR: 1.3, side: THREE.DoubleSide, depthWrite: false });
  const collarM = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.4, emissive: new THREE.Color(colour), emissiveIntensity: 0.2 });
  const seg = detail === 'low' ? 10 : 20;
  const ell = (rx, ry, rz, m) => { const e = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), m); e.scale.set(rx, ry, rz); e.castShadow = true; return e; };
  const body = new THREE.Group(); root.add(body);
  const abdomen = new THREE.Group(); abdomen.position.set(0, 0.42, -0.08); body.add(abdomen);
  abdomen.add(ell(0.4, 0.5, 0.4, tan));
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.39 - i * 0.06, 0.05, 6, seg), dark); b.rotation.x = Math.PI / 2; b.position.y = -0.05 - i * 0.16; b.scale.set(1, 1, 1); abdomen.add(b); }
  const thorax = new THREE.Group(); thorax.position.set(0, 1.05, 0.02); body.add(thorax);
  thorax.add(ell(0.33, 0.36, 0.31, ochre));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, seg), collarM); collar.rotation.x = Math.PI / 2 - 0.2; collar.position.set(0, 0.33, 0.04); thorax.add(collar);
  const head = new THREE.Group(); head.position.set(0, 1.62, 0.1); body.add(head);
  head.add(ell(0.25, 0.22, 0.22, tan));
  const eyes = [-1, 1].map(s => { const e = ell(0.17, 0.2, 0.16, eyeM); e.position.set(s * 0.19, 0.03, 0.06); head.add(e); return e; });
  const prob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 8), ochre); prob.position.set(0, -0.2, 0.12); prob.rotation.x = 0.4; head.add(prob);
  const antennae = [-1, 1].map(s => {
    const a = new THREE.Group(); a.position.set(s * 0.06, 0.08, 0.2); head.add(a);
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 6), ochre); s1.position.y = 0.05; a.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ochre); s2.position.y = 0.12; a.add(s2);
    const ar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 4), dark); ar.position.set(s * 0.06, 0.2, 0.03); ar.rotation.z = -s * 0.6; a.add(ar);
    a.rotation.x = 0.5;
    return a;
  });
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.bezierCurveTo(0.25, 0.1, 0.9, 0.05, 1.0, -0.12); wingShape.bezierCurveTo(0.85, -0.3, 0.3, -0.26, 0, -0.06);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 12);
  const wings = [-1, 1].map(s => {
    const w = new THREE.Group(); w.position.set(s * 0.18, 1.18, -0.18); body.add(w);
    const m = new THREE.Mesh(wingGeo, wingM); m.scale.set(s * 0.9, 0.9, 0.9); m.rotation.y = s * Math.PI / 2; w.add(m);
    w.rotation.set(0.9, 0, -s * 0.35);
    return w;
  });
  // legs: segments placed every frame from two-bone IK
  const segGeo = new THREE.CylinderGeometry(1, 0.8, 1, 6); segGeo.translate(0, 0.5, 0);
  const attach = [[-0.16, 0.93, 0.2], [0.16, 0.93, 0.2], [-0.26, 0.88, 0.06], [0.26, 0.88, 0.06], [-0.22, 0.78, -0.06], [0.22, 0.78, -0.06]];
  const lens = [[0.42, 0.42, 0.18], [0.42, 0.42, 0.18], [0.5, 0.52, 0.2], [0.5, 0.52, 0.2], [0.5, 0.5, 0.18], [0.5, 0.5, 0.18]];
  const legs = attach.map((a, i) => {
    const segs = [0, 1, 2].map(k => { const m = new THREE.Mesh(segGeo, k === 2 ? dark : ochre); m.castShadow = true; root.add(m); return m; });
    return { attach: new THREE.Vector3(...a), len: lens[i], segs, target: new THREE.Vector3(), side: i % 2 ? 1 : -1, r: [0.04, 0.032, 0.022] };
  });
  const rig = { root, body, head, eyes, antennae, wings, abdomen, thorax, legs, seed, phase: (seed * 1.7) % 6.28 };
  const dispose = () => { root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); [tan, ochre, dark, eyeM, wingM, collarM].forEach(m => m.dispose()); };
  return { root, rig, dispose };
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function placeSeg(m, a, b, r) {
  _v1.subVectors(b, a); const l = _v1.length() || 1e-4;
  m.position.copy(a); m.quaternion.setFromUnitVectors(_up, _v1.multiplyScalar(1 / l)); m.scale.set(r, l, r);
}
// Two-bone IK in the fly's local space: hip -> knee -> ankle, then the
// tarsus to the target. pole: the side the knee bends to.
function legTo(leg, target, pole) {
  const H = _v2.copy(leg.attach), [a, b, c] = leg.len;
  const P = new THREE.Vector3().copy(target);
  const dir = new THREE.Vector3().subVectors(P, H);
  let d = dir.length(); dir.normalize();
  const ankle = new THREE.Vector3().copy(P).addScaledVector(dir, -c);
  const toA = new THREE.Vector3().subVectors(ankle, H); d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, toA.length())); toA.normalize();
  const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const perp = new THREE.Vector3().copy(pole).addScaledVector(toA, -pole.dot(toA)).normalize();
  const knee = new THREE.Vector3().copy(H).addScaledVector(toA, a * ca).addScaledVector(perp, a * sa);
  const ank = new THREE.Vector3().copy(H).addScaledVector(toA, d);
  placeSeg(leg.segs[0], H, knee, leg.r[0]);
  placeSeg(leg.segs[1], knee, ank, leg.r[1]);
  placeSeg(leg.segs[2], ank, _v3.copy(ank).addScaledVector(toA, c * 0.4).add(new THREE.Vector3(0, -c * 0.8, 0)).lerp(P, 0.6), leg.r[2]);
}

// Clips: idle, think, groom, reach, place, tap, push, raiseArms, slump.
// t: seconds into the clip. opts: { dur, time, hand, rest, target, droop,
// shake } (points in world space).
function placeholderAnimate(rig, clipIn, t, opts = {}) {
  const clip = typeof clipIn === 'string' ? clipIn : clipIn?.name || 'idle';
  if (clipIn && typeof clipIn === 'object' && clipIn.target) opts = { ...opts, target: clipIn.target };
  const time = opts.time ?? t, dur = PLACEHOLDER_CLIPS[clip]?.duration || 1, k = Math.min(1, t / dur);
  const env = Math.sin(Math.PI * k);
  const root = rig.root;
  const local = v => v ? root.worldToLocal(_v3.copy(v)).clone() : null;
  const hand = local(opts.hand) || new THREE.Vector3(0, 1.3, 0.8);
  const rest = local(opts.rest) || new THREE.Vector3(0, 0.6, 0.9);
  const tgt = local(opts.target);
  // breathing and idle head motion
  rig.abdomen.scale.set(1, 1 + 0.025 * Math.sin(time * 2.1 + rig.phase), 1);
  rig.head.rotation.set(0.05 * Math.sin(time * 0.7 + rig.phase), 0.12 * Math.sin(time * 0.43 + rig.phase), 0);
  const tw = Math.sin(time * 9 + rig.phase) * 0.06;
  rig.antennae.forEach((a, i) => { a.rotation.x = 0.5 + tw * (i ? 1 : -1); });
  const droop = opts.droop || 0;
  rig.wings.forEach((w, i) => { const s = i ? 1 : -1; w.rotation.set(0.9 + droop * 0.5, 0, -s * (0.35 - droop * 0.25)); });
  rig.body.rotation.set(0, 0, 0); rig.body.position.set(0, 0, 0);
  let fl = new THREE.Vector3(hand.x - 0.22, hand.y, hand.z), fr = new THREE.Vector3(hand.x + 0.22, hand.y, hand.z);
  let ml = new THREE.Vector3(rest.x - 0.55, rest.y, rest.z), mr = new THREE.Vector3(rest.x + 0.55, rest.y, rest.z);
  const hl = new THREE.Vector3(-0.5, 0.0, 0.2), hr = new THREE.Vector3(0.5, 0.0, 0.2);
  switch (clip) {
    case 'think':
      rig.head.rotation.x += 0.25 * env; rig.head.rotation.z = 0.15 * env * Math.sin(rig.phase + 1);
      rig.antennae.forEach((a, i) => { a.rotation.x = 0.5 + Math.sin(time * 26 + i) * 0.18 * env; });
      break;
    case 'groom': {
      const rub = Math.sin(time * 14) * 0.06;
      const hp = new THREE.Vector3(0, 1.55, 0.32);
      fl.lerp(new THREE.Vector3(hp.x - 0.1 + rub, hp.y, hp.z), env); fr.lerp(new THREE.Vector3(hp.x + 0.1 - rub, hp.y, hp.z), env);
      rig.head.rotation.x += 0.2 * env;
      break;
    }
    case 'reach': if (tgt) fr.lerp(tgt, env); rig.head.rotation.x += 0.2 * env; break;
    case 'place': case 'tap': if (tgt) mr.lerp(tgt, env); rig.body.rotation.x = 0.12 * env; rig.head.rotation.x += 0.25 * env; break;
    case 'push': if (tgt) { ml.lerp(new THREE.Vector3(tgt.x - 0.3, tgt.y, tgt.z), env); mr.lerp(new THREE.Vector3(tgt.x + 0.3, tgt.y, tgt.z), env); } rig.body.rotation.x = 0.18 * env; break;
    case 'raiseArms': {
      const up = Math.min(1, k * 4);
      fl.lerp(new THREE.Vector3(-0.55, 2.1, 0.25), up); fr.lerp(new THREE.Vector3(0.55, 2.1, 0.25), up);
      rig.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.35 + 0.5 * Math.abs(Math.sin(time * 38))); });
      rig.head.rotation.x = -0.25 * up;
      break;
    }
    case 'slump': {
      const s = Math.min(1, k * 3);
      rig.body.rotation.x = 0.35 * s; rig.head.rotation.x = 0.5 * s;
      fl.lerp(new THREE.Vector3(-0.3, 0.75, 0.75), s); fr.lerp(new THREE.Vector3(0.3, 0.75, 0.75), s);
      rig.wings.forEach((w, i) => { w.rotation.x = 1.5; w.rotation.z = (i ? -1 : 1) * 0.05; });
      break;
    }
    default: break;
  }
  if (opts.shake) rig.body.position.x = Math.sin(time * 31) * 0.012;
  const pole = new THREE.Vector3(0, -0.3, -1);
  const legsT = [fl, fr, ml, mr, hl, hr];
  rig.legs.forEach((leg, i) => {
    const pl = i < 2 ? new THREE.Vector3(leg.side * 1, -1, -0.2) : i < 4 ? new THREE.Vector3(leg.side, 1, 0) : new THREE.Vector3(leg.side, 0.4, 1);
    legTo(leg, legsT[i], pl.normalize().add(pole.clone().multiplyScalar(0.2)));
  });
}
// Clip lengths of the stand-in: the CLIPS table shape of ui/fly3d/fly.js.
const PLACEHOLDER_CLIPS = {
  idle: { duration: 6, loop: true }, think: { duration: 2, loop: true }, groom: { duration: 2.8 },
  reach: { duration: 1.0, contact: 0.48 }, place: { duration: 1.3, contact: 0.66 }, tap: { duration: 0.8, contact: 0.36 },
  push: { duration: 1.2, contact: 0.38 }, raiseArms: { duration: 1.4, hold: true }, slump: { duration: 1.6, hold: true },
};
export const PLACEHOLDER_FLY = { buildFly: placeholderBuildFly, animate: placeholderAnimate, CLIPS: PLACEHOLDER_CLIPS, placeholder: true };
const PLACEHOLDER = PLACEHOLDER_FLY;

// ================================================================ scene
export function createDuelScene(canvas, opts = {}) {
  const headless = !!opts.headless || !canvas || typeof window === 'undefined';
  const mm = q => (typeof matchMedia !== 'undefined' ? matchMedia(q).matches : false);
  const reduced = opts.reduced ?? mm('(prefers-reduced-motion: reduce)');
  const coarse = opts.coarse ?? mm('(pointer: coarse)');
  const names = opts.names || ['Fly A', 'Fly B'];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d14);

  const W = {
    scene, reduced, coarse, headless,
    tex: textureCache(), sprites: spriteFactory(),
    cardGeo: cardGeometry(), ringGeo: ringGeometry(),
    cards: new THREE.Group(),
    fx: new THREE.Group(),
  };
  W.cards.name = 'cards'; W.fx.name = 'fx';
  const backTex = W.tex.back();
  W.backMat = new THREE.MeshStandardMaterial({ map: backTex || null, color: backTex ? 0xffffff : 0x111623, roughness: 0.6 });
  W.edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.8 });
  scene.add(buildRoom(W), buildTable(W), W.cards, W.fx);

  // ---------------------------------------------------------- lights
  const lights = buildLights(scene, W, coarse);

  // ---------------------------------------------------------- piles
  const pileGeo = new THREE.BoxGeometry(T.cardW * 0.98, 1, T.cardH * 0.98); pileGeo.translate(0, 0.5, 0);
  const pileMat = [W.edgeMat, W.edgeMat, W.backMat, W.edgeMat, W.edgeMat, W.edgeMat];
  // BoxGeometry face order: +x -x +y -y +z -z. The +y face shows the back.
  const piles = [0, 1].map(p => {
    const lib = new THREE.Mesh(pileGeo, pileMat);
    lib.position.copy(seatPos(p, T.deckU, 0.003, T.deckV)); lib.quaternion.copy(seatQuat(p, 0, 0, 0));
    lib.castShadow = lib.receiveShadow = true;
    scene.add(lib);
    const label = W.sprites.make('0', TOKENS.ink2, 0.2);
    label.position.copy(seatPos(p, T.deckU, 0.5, T.deckV));
    scene.add(label);
    return { lib, label, n: -1 };
  });

  // ---------------------------------------------------------- life drums
  const drums = [0, 1].map(p => { const d = buildLifeDrum(W, p); scene.add(d.grp); return d; });

  // ---------------------------------------------------------- flies
  const flies = [0, 1].map(p => ({
    p, holder: new THREE.Group(), mod: PLACEHOLDER, built: null,
    spec: { name: 'idle' }, t0: 0, rate: 1, until: Infinity, prev: null, mixT0: -1, tNow: 0,
    nextGroom: 6 + p * 4, end: null,
  }));
  const flyScale = opts.flyScale ?? T.flyScale;
  // fly.js units: the seated body is about 1 unit high, the table top is
  // tableY above the seat and the near table edge is tableZ in front.
  function mountFly(f, mod) {
    if (f.built) { f.holder.remove(f.built.root); try { f.built.dispose?.(); } catch { /* old fly */ } }
    f.mod = mod;
    const real = !mod.placeholder;
    const built = mod.buildFly({
      colour: FLY[f.p], seed: f.p + 1, lod: coarse ? 'phone' : 'desktop', detail: coarse ? 'low' : 'high',
      tableY: (T.y - T.seatTop) / flyScale, tableZ: (T.seatV - T.r) / flyScale,
    });
    f.built = built;
    if (real) built.root.scale.setScalar(flyScale);
    built.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    f.holder.add(built.root);
    f.holder.updateMatrixWorld(true);
  }
  for (const f of flies) {
    f.holder.position.copy(seatPos(f.p, 0, 0, T.seatV)); f.holder.position.y = T.seatTop;
    f.holder.rotation.y = YAW[f.p] + Math.PI;     // look toward the centre
    scene.add(f.holder);
    mountFly(f, PLACEHOLDER);
  }

  // ---------------------------------------------------------- brain maps
  const brains = [null, null];
  const brainHolders = [0, 1].map(p => {
    const g = new THREE.Group();
    g.rotation.y = YAW[p];
    scene.add(g);
    return g;
  });
  // A wide frame: both maps on the world -x side, away from the default
  // camera side. A tall frame (a phone) looks along the line between the
  // seats, so a map at the side is out of the frame. There, each map
  // floats above the head of its fly.
  function placeBrains(tall) {
    for (let p = 0; p < 2; p++) {
      if (tall) seatPos(p, 0, 2.55, T.seatV + 0.05, brainHolders[p].position);
      else seatPos(p, p === 0 ? -2.4 : 2.4, 2.1, T.seatV - 0.35, brainHolders[p].position);
    }
  }
  placeBrains(false);
  // One map per fly, from its own connectome (connectomes[1] may be the
  // FlyWire file of fly B). A thin ring in the seat colour and a label
  // stand under each map.
  async function mountBrains(mod) {
    if (!mod?.createBrainMap) return;
    const cons = opts.connectomes || [];
    for (let p = 0; p < 2; p++) {
      const c = cons[p] || cons[0];
      if (!c) continue;
      try {
        let neuropil = null;
        if (mod.loadNeuropil && typeof fetch === 'function' && !headless) neuropil = await mod.loadNeuropil(c, new URL('../../data/', import.meta.url)).catch(() => null);
        if (disposed) return;
        const bm = mod.createBrainMap(c, { colour: FLY[p], size: 0.62, lite: coarse, reducedMotion: reduced, neuropil });
        brainHolders[p].add(bm.group);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.01, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(FLY[p]) }));
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.82;
        brainHolders[p].add(ring);
        const label = W.sprites.make(`${names[p]} · model mushroom body`, TOKENS.ink2, 0.13, { size: 40 });
        label.position.y = -0.98; brainHolders[p].add(label);
        brains[p] = bm;
      } catch (e) { console.warn('fly-duel 3d: brain map failed', e); }
    }
  }

  // Load the real fly and the brain map when the files exist.
  const ready = Promise.all([
    import('./fly.js').then(m => (m && m.buildFly && m.animate ? m : null)).catch(() => null),
    (opts.connectomes ? import('./brain3d.js').catch(() => null) : Promise.resolve(null)),
  ]).then(([flyMod, brainMod]) => {
    if (disposed) return;
    if (flyMod) for (const f of flies) { try { mountFly(f, flyMod); } catch (e) { console.warn('fly-duel 3d: fly.js failed, keeping the stand-in', e); mountFly(f, PLACEHOLDER); } }
    return mountBrains(brainMod).then(() => ({ fly: flyMod ? 'fly.js' : 'placeholder', brain: brains.some(Boolean) }));
  });

  // ---------------------------------------------------------- state
  let mirror = null;
  const Z = { hand: [[], []], grave: [[], []], perms: new Map(), held: [null, null], pips: new Map(), flags: new Map() };
  const fx = [];                       // running effects { update(dt) -> bool alive }
  let now = 0, sceneT = 0, speed = 1, disposed = false;   // now: real s, sceneT: s times speed
  const queue = [];                    // { rec, resolve }
  let cur = null;                      // { rec, plan, t, i, resolve, struck: Set }
  let toAct = 0, winner = null;

  function clearCards() {
    for (const o of [...Z.hand[0], ...Z.hand[1], ...Z.grave[0], ...Z.grave[1], ...Z.perms.values(), ...Z.held]) o?.dispose();
    Z.hand = [[], []]; Z.grave = [[], []]; Z.perms.clear(); Z.held = [null, null];
    for (const pip of Z.pips.values()) W.fx.remove(pip);
    Z.pips.clear(); Z.flags.clear();
  }

  // Build every card object for a mirror and put it in place (no motion).
  function snapTo(m) {
    clearCards();
    mirror = m;
    for (let p = 0; p < 2; p++) {
      const pl = m.players[p];
      Z.hand[p] = pl.hand.map(id => new CardObj(W, id));
      Z.grave[p] = pl.graveyard.map(id => new CardObj(W, id));
      for (const x of pl.battlefield) { const o = new CardObj(W, x.id); o.uid = x.uid; Z.perms.set(x.uid, o); }
      if (m.held[p]) Z.held[p] = new CardObj(W, m.held[p]);
    }
    layout(true);
  }

  // ---------------------------------------------------------- layout
  const P = new THREE.Vector3(), Qt = new THREE.Quaternion();
  function rowSlots(n, half, gap) {
    if (!n) return [];
    const step = n > 1 ? Math.min(gap, (2 * half) / (n - 1)) : 0;
    const w = step * (n - 1);
    return Array.from({ length: n }, (_, i) => -w / 2 + i * step);
  }
  // The fan: on the fan anchor of fly.js (rig.fan, near the right front
  // hand, card faces along -Z to the fly, +Y up the cards). Card i turns
  // about the anchor, the first card at the fly's left (+X of the fly).
  const _fp = new THREE.Vector3(), _fq = new THREE.Quaternion(), _fs = new THREE.Vector3(), _lq = new THREE.Quaternion();
  const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  function handPose(p, i, n, out = P, q = Qt) {
    const spread = n > 1 ? Math.min(0.24, 1.3 / (n - 1)) : 0;
    const a = (i - (n - 1) / 2) * spread;
    const fan = flies[p].built?.rig?.fan;
    if (fan) {
      fan.matrixWorld.decompose(_fp, _fq, _fs);
      const r = T.fanR;
      out.set(-Math.sin(a) * r, Math.cos(a) * r, -0.02 - i * 0.007).applyQuaternion(_fq).add(_fp);
      _lq.setFromAxisAngle(_v1.set(0, 0, 1), a);
      q.copy(_fq).multiply(_lq).multiply(FLIP);
      return out;
    }
    const lx = Math.sin(a) * T.handR, ly = Math.cos(a) * T.handR;
    // the fan stands up with the faces to the fly, tops leaned back
    const lean = 0.42;
    const lz = i * 0.006;
    // card plane: x along the seat u (the fly's right), y up and leaned
    // back, the face toward the fly. Later cards lie nearer the fly.
    const u = lx, y = T.handY + ly * Math.cos(lean), v = T.handV + ly * Math.sin(lean) + lz;
    seatPos(p, u, y, v, out);
    seatQuat(p, lean, 0, -a, q);
    return out;
  }
  function permPose(p, x, out = P, q = Qt) {
    const o = Z.perms.get(x.uid), f = Z.flags.get(x.uid) || {};
    const pl = mirror.players[p];
    const land = CARD[x.id].type === 'land';
    const row = pl.battlefield.filter(y => (CARD[y.id].type === 'land') === land);
    const slots = rowSlots(row.length, T.rowHalf, land ? 0.62 : 0.68);
    const i = row.indexOf(x);
    let u = slots[i] ?? 0, v = land ? T.landV : T.creatureV, y = 0.006 + i * 0.0012;
    if (f.attacking) v = T.attackV;
    if (f.blocking != null) {
      const a = Z.perms.get(f.blocking);
      if (a) { const ap = a.toP; u = p === 0 ? ap.x : -ap.x; v = T.attackV; }
    }
    // tapped: turn a little (not 90 degrees, DESIGN.md 3.6) and come
    // 0.1 toward the seat.
    const turn = x.tapped ? -0.38 : 0;
    if (x.tapped && !f.attacking) v += 0.08;
    seatPos(p, u, y, v, out);
    seatQuat(p, -Math.PI / 2, 0, turn, q);
    if (o) {
      o.dimTo = x.tapped ? (land ? 0.42 : 0.62) : 1;
      o.glowTo = land && !x.tapped ? 0.16 : 0;
      o.scaleTo = x.pp > 0 ? 1.12 : 1;
      const col = f.attacking ? FLY[p] : f.blocking != null ? FLY[p] : f.target ? TOKENS.dmg : null;
      o.ring.visible = !!col; if (col) o.ring.material.color.set(col);
      updateBadge(o, x);
    }
    return out;
  }
  function gravePose(p, i, out = P, q = Qt) {
    const jit = ((i * 7919) % 13) / 13 - 0.5;
    seatPos(p, T.graveU + jit * 0.04, 0.006 + i * 0.007, T.graveV, out);
    seatQuat(p, -Math.PI / 2, 0, jit * 0.25, q);
    return out;
  }
  function stagePose(p, out = P, q = Qt) {
    seatPos(p, T.stageU, T.stageY, T.stageV, out);
    seatQuat(p, -0.45, Math.PI, 0, q);  // the face looks to the centre and up
    return out;
  }
  function libraryTop(p, out = P, q = Qt) {
    const n = mirror ? mirror.players[p].library : 20;
    seatPos(p, T.deckU, 0.004 + n * 0.007, T.deckV, out);
    seatQuat(p, Math.PI / 2, 0, 0, q);  // face down
    return out;
  }
  function layout(snap = false) {
    if (!mirror) return;
    for (let p = 0; p < 2; p++) {
      const pl = mirror.players[p];
      const H = Z.hand[p];
      H.forEach((o, i) => {
        handPose(p, i, H.length); snap ? o.place(P, Qt) : o.target(P, Qt, 0.3, 0, true);
        o.scaleTo = T.handScale; o.dimTo = 1; o.glowTo = 0; o.ring.visible = false;
      });
      for (const x of pl.battlefield) { const o = Z.perms.get(x.uid); if (!o) continue; permPose(p, x); snap ? o.place(P, Qt) : o.target(P, Qt, 0.35); }
      Z.grave[p].forEach((o, i) => { gravePose(p, i); snap ? o.place(P, Qt) : o.target(P, Qt, 0.4); o.scaleTo = 1; o.dimTo = 1; o.glowTo = 0; o.ring.visible = false; if (o.badge) updateBadge(o, { id: 'x', dmg: 0, pp: 0 }); });
      if (Z.held[p]) { const o = Z.held[p]; stagePose(p); snap ? o.place(P, Qt) : o.target(P, Qt, 0.4); o.scaleTo = 1; o.dimTo = 1; o.glowTo = 0; o.ring.visible = false; }
      // library pile height and count
      const n = pl.library;
      const pile = piles[p];
      pile.lib.scale.y = Math.max(0.0005, n * 0.007); pile.lib.visible = n > 0;
      if (pile.n !== n) {
        pile.n = n;
        const old = pile.label; const pos = old.position.clone();
        scene.remove(old); old.material.dispose();
        pile.label = W.sprites.make(String(n), TOKENS.ink2, 0.2); pile.label.position.copy(pos); pile.label.position.y = T.y + n * 0.007 + 0.2;
        scene.add(pile.label);
      }
      // mana pips on untapped lands
      for (const x of pl.battlefield) {
        if (CARD[x.id].type !== 'land') continue;
        const has = Z.pips.get(x.uid);
        if (!x.tapped && !has) addPip(p, x);
        if (x.tapped && has && !has.userData.flying) { W.fx.remove(has); Z.pips.delete(x.uid); }
      }
      // drums
      const d = drums[p];
      if (d.value !== pl.life) {
        const first = d.value == null;
        const col = first ? TOKENS.ink : pl.life < d.value ? TOKENS.dmg : TOKENS.heal;
        d.value = pl.life; d.draw(pl.life, col); d.flash = first ? 0 : 1.1;
        if (!first) d.spinTo += Math.PI / 2;
      }
    }
    // pips that lost their land
    for (const [uid, pip] of Z.pips) if (!Z.perms.has(uid) && !pip.userData.flying) { W.fx.remove(pip); Z.pips.delete(uid); }
  }

  // The dmg / pump badge on a creature: shows power / toughness left.
  function updateBadge(o, x) {
    const card = CARD[x.id] || { type: 'creature' };
    if (card.type !== 'creature') return;
    const key = x.dmg || x.pp ? `${(card.power || 0) + x.pp}/${(card.toughness || 0) + x.pp - x.dmg}|${x.dmg}` : '';
    if (key === o.badgeKey) return;
    o.badgeKey = key;
    if (o.badge) { o.mesh.remove(o.badge); o.badge.material.map?.dispose(); o.badge.material.dispose(); o.badge = null; }
    if (!key) return;
    const cv = makeCanvas(160, 64);
    let tex = null;
    if (cv?.getContext) {
      const g = cv.getContext('2d');
      g.fillStyle = x.dmg ? TOKENS.dmg : TOKENS.heal; g.fillRect(0, 0, 160, 64);
      g.fillStyle = TOKENS.bg; g.font = `700 44px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(key.split('|')[0], 80, 34);
      tex = canvasTexture(cv, { aniso: 4 });
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : new THREE.Color(x.dmg ? TOKENS.dmg : TOKENS.heal) }));
    m.position.set(T.cardW / 2 - 0.16, -T.cardH / 2 + 0.08, T.cardT / 2 + 0.003);
    o.mesh.add(m); o.badge = m;
  }

  const tokGeo = tokenGeos(), tokMat = tokenMats();
  function pipPose(p, uid, out = new THREE.Vector3()) {
    const o = Z.perms.get(uid);
    const base = o ? o.toP : seatPos(p, 0, 0, T.landV);
    out.copy(base);
    // toward the top end of the land card (the centre side)
    out.add(seatPos(p, 0, 0, -0.2, _v1).sub(seatPos(p, 0, 0, 0, _v2)));
    out.y = T.y + 0.06;
    return out;
  }
  function addPip(p, x) {
    const kind = CARD[x.id].produces === 'amber' ? 'amber' : 'moss';
    const m = new THREE.Mesh(tokGeo[kind], tokMat[kind]);
    m.castShadow = true;
    m.userData = { kind, p, uid: x.uid, grow: W.reduced ? 1 : 0 };
    m.position.copy(pipPose(p, x.uid)); m.rotation.y = YAW[p] + (kind === 'amber' ? Math.PI / 6 : 0);
    m.scale.setScalar(m.userData.grow);
    W.fx.add(m); Z.pips.set(x.uid, m);
  }

  // ---------------------------------------------------------- effects
  function addFx(f) { fx.push(f); return f; }
  function floatNumber(text, colour, at, { rise = 0.45, hold = 0.9, height = 0.36 } = {}) {
    const s = W.sprites.make(text, colour, height);
    s.position.copy(at); W.fx.add(s);
    const y0 = at.y; let t = 0; const life = (W.reduced ? 0 : 0.5) + hold;
    addFx({ update(dt) {
      t += dt;
      const k = W.reduced ? 1 : easeOut(t / 0.5);
      s.position.y = y0 + rise * k;
      if (t > life) { s.material.opacity = Math.max(0, 1 - (t - life) / 0.25); }
      if (t > life + 0.25) { W.fx.remove(s); s.material.dispose(); return false; }
      return true;
    } });
  }
  function banner(text, colour, at, secs = 1.4) { floatNumber(text, colour, at, { rise: 0.1, hold: secs, height: 0.32 }); }
  function bannerPanel(text, colour, at, secs = 1.6) {
    const s = W.sprites.make(text, colour, 0.42, { size: 44, panel: true });
    s.position.copy(at); W.fx.add(s); let t = 0;
    addFx({ update(dt) { t += dt; if (t > secs) s.material.opacity = Math.max(0, 1 - (t - secs) / 0.3); if (t > secs + 0.3) { W.fx.remove(s); s.material.dispose(); return false; } return true; } });
  }
  // A hard line from a to b in colour, drawn from a, then cut from a.
  function spark(a, b, colour, dur) {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6); geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour) });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a); m.quaternion.setFromUnitVectors(_up, _v1.subVectors(b, a).normalize());
    W.fx.add(m);
    const dir = _v1.clone();
    const shards = [];
    let t = 0; dur = Math.max(0.25, dur);
    addFx({ update(dt) {
      t += dt; const k = W.reduced ? 1 : t / dur;
      const head = Math.min(1, k / 0.45), tail = Math.max(0, (k - 0.55) / 0.45);
      m.position.copy(a).addScaledVector(dir, tail * len);
      m.scale.set(1, Math.max(1e-3, (head - tail) * len), 1);
      if (head >= 1 && !shards.length) {
        for (let i = 0; i < 7; i++) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.16), mat);
          const d = new THREE.Vector3(Math.cos(i * 0.9) , 0.6 + (i % 3) * 0.3, Math.sin(i * 0.9)).normalize();
          s.position.copy(b); s.lookAt(_v2.copy(b).add(d)); s.userData.d = d; W.fx.add(s); shards.push(s);
        }
      }
      for (const s of shards) s.position.addScaledVector(s.userData.d, dt * 1.6);
      if (k >= 1) { W.fx.remove(m); geo.dispose(); for (const s of shards) { W.fx.remove(s); s.geometry.dispose(); } mat.dispose(); return false; }
      return true;
    } });
  }
  // A mana token flies from a land to a slot on the cost rail of the held
  // card. A token that pays a generic cost turns into a grey square on the
  // way.
  function flyToken(pip, p, slot, pays, dur, delay = 0) {
    pip.userData.flying = true;
    const from = pip.position.clone();
    let t = W.reduced ? 0 : -delay;
    const swapAt = 0.5;
    addFx({ update(dt) {
      t += dt; const k = W.reduced ? 1 : Math.max(0, Math.min(1, t / Math.max(0.05, dur)));
      const held = Z.held[p];
      const to = held ? held.mesh.localToWorld(_v2.set(-T.cardW / 2 + 0.07, T.cardH / 2 - 0.13 - slot * 0.1, 0.03)) : stagePose(p, _v2);
      const e = easeIO(k);
      pip.position.lerpVectors(from, to, e); pip.position.y += 0.55 * 4 * e * (1 - e);
      pip.rotation.x = e * Math.PI * 1.0;
      if (pays === 'generic' && k > swapAt && pip.userData.kind !== 'generic') { pip.geometry = tokGeo.generic; pip.material = tokMat.generic; pip.userData.kind = 'generic'; }
      const sc = k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1;
      pip.scale.setScalar(0.95 * sc + 0.05);
      if (k >= 1) { W.fx.remove(pip); if (held) held.pulse = 1; return false; }
      return true;
    } });
  }

  // ---------------------------------------------------------- fly clips
  // Start a clip on fly p. target / to: world points. contactAt: scene
  // seconds from now when the working tarsus should touch the target (the
  // clip plays faster or slower to meet it). dur: play the whole one-shot
  // clip in dur seconds. until: go back to idle after this many seconds.
  const clipDef = (f, name) => (f.mod.CLIPS || PLACEHOLDER_CLIPS)[name] || PLACEHOLDER_CLIPS[name] || { duration: 1 };
  function clip(p, name, { target = null, to = null, contactAt = null, dur = null, until = Infinity } = {}) {
    const f = flies[p], def = clipDef(f, name);
    let rate = 1;
    if (contactAt != null && def.contact) rate = def.contact / Math.max(0.05, contactAt);
    else if (dur != null) rate = def.duration / Math.max(0.05, dur);
    f.prev = { clip: f.spec, t: f.tNow }; f.mixT0 = sceneT;
    f.spec = { name };
    if (target) f.spec.target = target.clone();
    if (to) f.spec.to = to.clone();
    f.t0 = sceneT; f.rate = Math.min(8, Math.max(0.25, rate)); f.until = sceneT + until;
  }
  const handAnchor = p => seatPos(p, 0, T.handY + 0.15, T.handV + 0.05);
  const restAnchor = p => seatPos(p, 0, 0.02, T.r - 0.15);
  const flyHead = p => seatPos(p, 0, 1.15, T.seatV - 0.15);

  // ---------------------------------------------------------- director
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 80);
  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), wantPos: new THREE.Vector3(), wantLook: new THREE.Vector3(), shot: 'wide', p: 0, az: 0.35, userUntil: -1, since: -99 };
  // A shot holds at least HOLD seconds (scene time), so the camera does
  // not swing on each small decision. force: a cast, a combat or the end
  // of the game cuts at once.
  const HOLD = 3.2;
  const TALL = 0.95;
  // Camera mode (setCamera): 'auto' lets the steps call director();
  // 'wide' holds the wide shot; 'free' leaves the camera to the user's
  // orbit; 'script' takes shots only from shoot() (the saver director).
  let camMode = 'auto';
  function director(shot, p = 0, force = false) {
    if (camMode !== 'auto') return;
    if (cam.shot === shot && cam.p === p) return;
    if (!force && sceneT - cam.since < HOLD) return;
    cam.shot = shot; cam.p = p; cam.since = sceneT;
  }
  function shotPose(dt) {
    const aspect = camera.aspect || 1.6;
    const fit = Math.max(1, 1.45 / aspect);           // tall frames step back
    const s = speed > 2.5 ? 'wide' : cam.shot;
    // A tall frame (a phone, aspect < TALL) does not step back from the
    // side view: at 0.65 the camera went past the wall and each fly was
    // about 70 px high. The wide and combat shots look along the line
    // between the seats instead, so one fly is near and one is far.
    if (aspect < TALL && (s === 'wide' || s === 'win' || s === 'combat')) {
      const r = 13.5 * Math.max(1, 0.68 / aspect);
      let el = 0.55, az = 0.28, toward = 0.8;
      if (s === 'combat') { el = 0.75; az = cam.p === 0 ? 0.3 : Math.PI + 0.3; toward = cam.p === 0 ? 0.6 : -0.6; }
      else if (!W.reduced) { cam.az += dt * 0.05; az += 0.12 * Math.sin(cam.az); }
      cam.wantLook.set(0, T.y + 0.3, toward);
      cam.wantPos.set(Math.sin(az) * Math.cos(el) * r, T.y + 0.3 + Math.sin(el) * r, toward + Math.cos(az) * Math.cos(el) * r);
    } else if (s === 'wide' || s === 'win') {
      if (!W.reduced) cam.az += dt * 0.05;
      const r = 10 * fit, el = 0.48;
      const az = Math.PI / 2 + 0.55 * Math.sin(cam.az);
      cam.wantLook.set(0, T.y + 0.5, 0);
      cam.wantPos.set(Math.sin(az) * Math.cos(el) * r, T.y + 0.5 + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    } else if (s === 'over') {
      // over the right shoulder of the fly, high enough to see its fan
      seatPos(cam.p, (cam.p === 0 ? 2.0 : -2.0) * fit, 3.0, T.seatV + 0.9 * fit, cam.wantPos);
      seatPos(cam.p, -0.2, 0.25, T.seatV - 1.7, cam.wantLook);
    } else if (s === 'close') {
      // in front of the held card: the card face, the mana tokens and
      // the face of the fly behind it
      seatPos(cam.p, -0.35, 1.5, T.stageV - 2.2 * fit, cam.wantPos);
      seatPos(cam.p, 0.3, T.stageY + 0.05, T.stageV + 0.35, cam.wantLook);
    } else if (s === 'combat') {
      const side = cam.p === 0 ? 1 : -1;
      cam.wantPos.set(7.6 * fit, T.y + 3.6, 1.2 * side);
      cam.wantLook.set(0, T.y + 0.1, 0);
    }
  }
  // Cut to a shot now, in any mode but 'free' (the saver and the page).
  function shoot(shot, p = 0) { cam.shot = shot; cam.p = p | 0; cam.since = sceneT; }
  function setCamera(mode) {
    camMode = ['auto', 'wide', 'free', 'script'].includes(mode) ? mode : 'auto';
    if (camMode === 'wide') shoot('wide');
    cam.userUntil = camMode === 'free' ? Infinity : now;
    if (camMode !== 'free') { cam.pos.copy(camera.position); if (controls) cam.look.copy(controls.target); }
  }
  function updateCamera(dt) {
    shotPose(dt);
    if (now < cam.userUntil) return;
    const k = W.reduced ? 1 : 1 - Math.exp(-dt * 1.9);
    cam.pos.lerp(cam.wantPos, k); cam.look.lerp(cam.wantLook, k);
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    if (controls) controls.target.copy(cam.look);
  }

  // ---------------------------------------------------------- steps
  const worldOfTarget = (to, out = new THREE.Vector3()) => {
    if (typeof to === 'string') return out.copy(flyHead(+to.slice(1))).add(new THREE.Vector3(0, -0.2, 0));
    const o = Z.perms.get(to);
    return o ? out.copy(o.toP).add(new THREE.Vector3(0, 0.08, 0)) : out.set(0, T.y, 0);
  };
  const STEP = {
    think(s) {
      toAct = s.p;
      clip(s.p, 'think', { until: s.dur + 0.3 });
      if (!s.bot && cur?.rec) brains[s.p]?.fire?.(cur.rec.trace, cur.rec.delta);
      const ty = cur?.rec?.action?.type;
      if (ty === 'attack' && cur.rec.action.attackers.length) director('combat', s.p, true);
      else if (ty === 'block') director('combat', s.p);
      else if (ty === 'land' || ty === 'cast') director('over', s.p);
    },
    lift(s) {
      const H = Z.hand[s.p];
      let i = s.from != null && mirror.players[s.p].hand[s.from] === s.card ? s.from : mirror.players[s.p].hand.indexOf(s.card);
      let o = i >= 0 ? H.splice(i, 1)[0] : null;
      if (!o) { o = new CardObj(W, s.card); handPose(s.p, 0, 1); o.place(P, Qt); }
      if (o.id !== s.card) { o.dispose(); o = new CardObj(W, s.card); handPose(s.p, 0, 1); o.place(P, Qt); }
      // the hand touches the card at 45 % of the step, then the card rises
      const touch = s.dur * 0.45;
      Z.held[s.p] = o; o.next = { dur: s.dur - touch, arc: 0.35, delay: touch };
      clip(s.p, 'reach', { target: o.mesh.position, contactAt: touch });
      if (CARD[s.card].type !== 'land') director('close', s.p, true);
    },
    land(s) {
      const o = Z.held[s.p] || new CardObj(W, s.card);
      Z.held[s.p] = null; o.uid = s.uid; Z.perms.set(s.uid, o); o.next = { dur: s.dur, arc: 0.3 };
      const x = mirrorSlot(s.p, s.uid, s.card);
      clip(s.p, 'place', { target: x, contactAt: s.dur });
    },
    tap(s) {
      const o = Z.perms.get(s.uid);
      const pip = Z.pips.get(s.uid);
      // the tarsus touches the land at 30 % of the step, then the token goes
      const touch = s.dur * 0.3;
      if (pip) { Z.pips.delete(s.uid); flyToken(pip, s.p, s.slot || 0, s.pays, s.dur - touch, touch); }
      if (o) clip(s.p, 'tap', { target: o.toP, contactAt: Math.max(0.05, touch) });
    },
    cast(s) {
      const o = Z.held[s.p] || new CardObj(W, s.card);
      Z.held[s.p] = null; o.uid = s.uid; Z.perms.set(s.uid, o); o.next = { dur: s.dur, arc: 0.35 };
      clip(s.p, 'place', { target: mirrorSlot(s.p, s.uid, s.card), contactAt: s.dur });
    },
    reveal(s) { const o = Z.held[s.p]; if (o) o.pulse = 1; },
    spark(s) {
      const o = Z.held[s.p];
      const a = o ? o.mesh.position.clone() : stagePose(s.p).clone();
      const b = worldOfTarget(s.to);
      spark(a, b, PALETTE[colourKey(CARD[s.card]?.colour)].ink, s.dur || 0.4);
      if (typeof s.to === 'number') { const f = Z.flags.get(s.to) || {}; f.target = true; Z.flags.set(s.to, f); }
      if (typeof s.to === 'string' && s.amount) { cur?.struck?.add(+s.to.slice(1)); floatNumber(`-${s.amount}`, TOKENS.dmg, drums[+s.to.slice(1)].grp.position.clone().add(new THREE.Vector3(0, 0.75, 0))); }
    },
    hurt(s) { const o = Z.perms.get(s.uid); if (o) floatNumber(`-${s.amount}`, TOKENS.dmg, o.toP.clone().add(new THREE.Vector3(0, 0.25, 0))); },
    pump(s) { const o = Z.perms.get(s.uid); if (o) { o.pulse = 1; floatNumber(`+${s.amount}/+${s.amount}`, TOKENS.heal, o.toP.clone().add(new THREE.Vector3(0, 0.3, 0)), { height: 0.28 }); } },
    token(s) {
      // the token appears in its own slot (the mirror gets it after this)
      const o = new CardObj(W, s.card); o.uid = s.uid; Z.perms.set(s.uid, o);
      o.place(mirrorSlot(s.p, s.uid, s.card), seatQuat(s.p, -Math.PI / 2, 0, 0));
      o.scale = W.reduced ? 1 : 0.05; o.scaleTo = 1;
    },
    draw(s) {
      const o = new CardObj(W, s.card);
      libraryTop(s.p); o.place(P, Qt);
      o.next = { dur: s.dur, arc: 0.6 };
      Z.hand[s.p].push(o);
    },
    spent(s) {
      const o = Z.held[s.p] || new CardObj(W, s.card);
      Z.held[s.p] = null; Z.grave[s.p].push(o); o.next = { dur: s.dur, arc: 0.4 };
    },
    attack(s) {
      const touch = s.dur * 0.3;
      for (const u of s.uids) { const f = Z.flags.get(u) || {}; f.attacking = true; Z.flags.set(u, f); const o = Z.perms.get(u); if (o) o.next = { dur: s.dur - touch, arc: 0.12, delay: touch }; }
      const first = Z.perms.get(s.uids[0]);
      if (first) clip(s.p, 'push', { target: first.toP, to: seatPos(s.p, 0, 0, T.attackV), contactAt: touch });
      director('combat', s.p);
    },
    block(s) {
      const touch = s.dur * 0.3;
      for (const [a, b] of s.pairs) { const f = Z.flags.get(b) || {}; f.blocking = a; Z.flags.set(b, f); const o = Z.perms.get(b); if (o) o.next = { dur: s.dur - touch, arc: 0.15, delay: touch }; }
      const first = Z.perms.get(s.pairs[0]?.[1]);
      if (first) clip(s.p, 'push', { target: first.toP, to: seatPos(s.p, 0, 0, T.attackV), contactAt: touch });
      director('combat', s.p);
    },
    strike(s) {
      const o = Z.perms.get(s.from);
      const b = worldOfTarget(s.to);
      if (o) { const dir = b.clone().sub(o.toP); dir.y = 0; const len = Math.min(0.5, dir.length() * 0.45); dir.normalize(); o.lunge = { dir, len: W.reduced ? 0 : len, t: 0, dur: Math.max(0.2, s.dur) }; }
      if (typeof s.to === 'string') {
        const q = +s.to.slice(1);
        cur?.struck?.add(q);
        floatNumber(`-${s.amount}`, TOKENS.dmg, drums[q].grp.position.clone().add(new THREE.Vector3(0, 0.75, 0)));
        clip(q, 'slump', { dur: 0.6, until: 0.45 });   // a short flinch
      } else {
        const t = Z.perms.get(s.to);
        if (t) floatNumber(`-${s.amount}`, TOKENS.dmg, t.toP.clone().add(new THREE.Vector3(0, 0.25, 0)));
      }
    },
    life(s) {
      const d = s.to - s.from;
      if (!(cur?.struck?.has(s.p) && d < 0)) floatNumber(d > 0 ? `+${d}` : `${d}`, d > 0 ? TOKENS.heal : TOKENS.dmg, drums[s.p].grp.position.clone().add(new THREE.Vector3(0, 0.75, 0)));
    },
    die(s) {
      const o = Z.perms.get(s.uid);
      Z.perms.delete(s.uid); Z.flags.delete(s.uid);
      if (!o) { if (!s.token) { const g = new CardObj(W, s.card); Z.grave[s.p].push(g); } return; }
      o.ring.visible = false; o.lunge = null;
      if (s.token) {
        o.scaleTo = 0.01; let t = 0;
        addFx({ update(dt) { t += dt; if (t > (W.reduced ? 0 : s.dur)) { o.dispose(); return false; } return true; } });
        trackLoose(o);
      } else { Z.grave[s.p].push(o); o.next = { dur: s.dur, arc: 0.55 }; }
    },
    settle() {
      director('wide');
      for (const [u, f] of Z.flags) { delete f.attacking; delete f.blocking; delete f.target; if (!Object.keys(f).length) Z.flags.delete(u); } },
    discard(s) {
      const H = Z.hand[s.p];
      const i = mirror.players[s.p].hand.indexOf(s.card);
      const o = i >= 0 ? H.splice(i, 1)[0] : new CardObj(W, s.card);
      Z.grave[s.p].push(o); o.next = { dur: s.dur, arc: 0.5 };
    },
    endturn() { for (const f of Z.flags.values()) delete f.target; },
    turn(s) {
      toAct = s.active;
      bannerPanel(`Turn ${s.turn} · ${names[s.active]}`, FLY[s.active], new THREE.Vector3(0, T.y + 2.3, 0), 1.2);
      director('wide');
    },
    untap() { /* layout reads the mirror: lands brighten, pips grow back */ },
    pass(s) {
      const label = s.label === 'combat' ? 'to combat' : s.label;
      clip(s.p, 'idle');
      banner(label, TOKENS.ink2, flyHead(s.p).add(new THREE.Vector3(0, 0.75, 0)), 0.8);
    },
    win(s) {
      winner = s.winner;
      const text = s.winner < 0 ? `Draw · ${s.reason}` : `${names[s.winner]} wins`;
      bannerPanel(text, s.winner < 0 ? TOKENS.ink : FLY[s.winner], new THREE.Vector3(0, T.y + 2.4, 0), 3.0);
      for (let p = 0; p < 2; p++) {
        clip(p, s.winner >= 0 && p === s.winner ? 'raiseArms' : 'slump');
        flies[p].end = s.winner < 0 ? 'slump' : p === s.winner ? 'raiseArms' : 'slump';
      }
      director('win', 0, true);
    },
    sync() {
      const want = mirrorOf(cur.rec.after);
      const diff = mirrorDiff(mirror, want);
      if (diff.length) { console.warn('fly-duel 3d: mirror drift, snap', diff); snapTo(want); }
    },
  };
  const loose = new Set();
  function trackLoose(o) { loose.add(o); }

  function runStep(s) {
    // hand and graveyard arrays follow the mirror; handlers that need the
    // old mirror (lift, discard) run before applyStep.
    const h = STEP[s.op];
    try { h?.(s); } catch (e) { console.warn('fly-duel 3d: step failed', s.op, e); }
    applyStep(mirror, s);
  }

  // ---------------------------------------------------------- play
  function startNext() {
    if (cur || !queue.length) return;
    const { rec, resolve } = queue.shift();
    if (!mirror || mirrorDiff(mirror, mirrorOf(rec.before)).length) {
      // a new game or a skipped record: put the table in its before state
      winner = null; for (const f of flies) { f.end = null; clip(f.p, 'idle'); }
      snapTo(mirrorOf(rec.before));
    }
    const plan = choreograph(rec, { reduced: W.reduced });
    cur = { rec, plan, t: 0, i: 0, resolve, struck: new Set() };
  }
  function advance(dt) {
    startNext();
    if (!cur) return;
    cur.t += dt;
    const S = cur.plan.steps;
    while (cur.i < S.length && S[cur.i].at <= cur.t) runStep(S[cur.i++]);
    if (cur.i >= S.length && cur.t >= cur.plan.total) {
      const done = cur; cur = null;
      done.resolve(done.plan);
      startNext();
    }
  }

  // ---------------------------------------------------------- renderer
  let renderer = null, controls = null, io = null, visible = true;
  if (!headless) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = !coarse;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    scene.traverse(o => { const ms = o.material ? [].concat(o.material) : []; for (const m of ms) if (m.map) m.map.anisotropy = Math.min(8, maxAniso); });
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !reduced; controls.dampingFactor = 0.08;
    controls.minDistance = 3; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI * 0.48;
    controls.enablePan = false;
    controls.addEventListener('start', () => { cam.userUntil = Infinity; });
    controls.addEventListener('end', () => { cam.userUntil = camMode === 'free' ? Infinity : now + 7; cam.pos.copy(camera.position); cam.look.copy(controls.target); });
    canvas.style.touchAction = 'pan-y';
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(es => { for (const e of es) visible = e.isIntersecting; });
      io.observe(canvas);
    }
  }
  function resize() {
    const w = Math.max(1, canvas?.clientWidth || 960), h = Math.max(1, canvas?.clientHeight || 540);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    placeBrains(camera.aspect < TALL);
    renderer?.setSize(w, h, false);
  }
  resize();
  shotPose(0); cam.pos.copy(cam.wantPos); cam.look.copy(cam.wantLook);
  camera.position.copy(cam.pos); camera.lookAt(cam.look);

  // ---------------------------------------------------------- frame
  function render(dtIn = 1 / 60) {
    if (disposed) return;
    if (!headless && (!visible || (typeof document !== 'undefined' && document.hidden))) return;
    const dt = Math.min(0.1, Math.max(0, dtIn));
    now += dt;
    const sdt = dt * speed;
    sceneT += sdt;
    advance(sdt);
    animateFlies();
    layout(false);
    for (const o of Z.hand[0]) o.update(sdt);
    for (const o of Z.hand[1]) o.update(sdt);
    for (const o of Z.grave[0]) o.update(sdt);
    for (const o of Z.grave[1]) o.update(sdt);
    for (const o of Z.perms.values()) o.update(sdt);
    for (const o of Z.held) o?.update(sdt);
    for (const o of loose) { o.update(sdt); if (!o.mesh.parent) loose.delete(o); }
    for (let i = fx.length - 1; i >= 0; i--) if (!fx[i].update(sdt)) fx.splice(i, 1);
    for (const pip of Z.pips.values()) {
      const u = pip.userData;
      if (u.flying) continue;
      if (u.grow < 1) { u.grow = Math.min(1, u.grow + sdt * 4); pip.scale.setScalar(easeOut(u.grow)); }
      pipPose(u.p, u.uid, pip.position);
    }
    for (let p = 0; p < 2; p++) {
      const d = drums[p];
      if (d.flash > 0) { d.flash -= dt; if (d.flash <= 0) d.draw(d.value, TOKENS.ink); }
      d.spin += (d.spinTo - d.spin) * (W.reduced ? 1 : 1 - Math.exp(-dt * 9));
      d.drum.rotation.y = d.spin;
      W.inlay[p].color.set(p === toAct && winner == null ? FLY[p] : TOKENS.faint);
    }
    for (let p = 0; p < 2; p++) brains[p]?.update?.(dt);
    updateCamera(dt);
    if (controls && now < cam.userUntil) controls.update();
    renderer?.render(scene, camera);
  }

  // Pose both flies for this frame. One-shot clips go back to idle when
  // they end (or at until). A short cross-fade hides every clip change.
  function animateFlies() {
    for (const f of flies) {
      const pl = mirror?.players[f.p];
      const life = pl ? pl.life : 20;
      const def = clipDef(f, f.spec.name);
      let t = (sceneT - f.t0) * f.rate;
      const over = (!def.loop && !def.hold && t >= def.duration) || sceneT >= f.until;
      // the fly that waits grooms now and then (idle is a loop clip, so
      // the groom starts from idle, not from the end of a clip)
      const groom = (!cur?.rec || cur.rec.who !== f.p) && sceneT > f.nextGroom && !f.end && !W.reduced;
      if (over || (f.spec.name === 'idle' && groom)) {
        if (groom) { clip(f.p, 'groom'); f.nextGroom = sceneT + 10 + ((f.p * 7 + Math.floor(sceneT)) % 7); }
        else clip(f.p, f.end || 'idle');
        t = 0;
      }
      f.tNow = f.spec.name === 'idle' ? sceneT : t;
      f.built.rig.setLife?.(Math.max(0, Math.min(1, life / 20)));
      const mix = W.reduced ? 1 : Math.min(1, (sceneT - f.mixT0) / 0.22);
      const o = {
        time: now, prev: f.prev && mix < 1 ? f.prev : undefined, mix,
        hand: handAnchor(f.p), rest: restAnchor(f.p),
        droop: Math.max(0, Math.min(1, (20 - life) / 20)), shake: life <= 5 && !W.reduced,
      };
      try { f.mod.animate(f.built.rig, f.spec, f.tNow, o); }
      catch (e) { if (!f.warned) { console.warn('fly-duel 3d: animate failed', e); f.warned = true; } }
      f.built.root.updateMatrixWorld(true);
    }
  }

  // Where a new permanent of card id will lie (the next slot of its row).
  function mirrorSlot(p, uid, id) {
    const pl = mirror.players[p];
    const land = CARD[id]?.type === 'land';
    const row = pl.battlefield.filter(y => (CARD[y.id].type === 'land') === land && y.uid !== uid);
    const n = row.length + 1;
    const slots = rowSlots(n, T.rowHalf, land ? 0.62 : 0.68);
    return seatPos(p, slots[n - 1], 0.01, land ? T.landV : T.creatureV);
  }

  // ---------------------------------------------------------- API
  function play(rec) {
    return new Promise(resolve => { queue.push({ rec, resolve }); if (!mirror) startNext(); });
  }
  function setState(state) {
    queue.length = 0;
    if (cur) { cur.resolve(cur.plan); cur = null; }
    for (const f of fx) f.dispose?.();
    winner = state.result ? state.result.winner : null;
    for (const f of flies) { f.end = null; clip(f.p, 'idle'); }
    toAct = state.toAct ?? 0;
    snapTo(mirrorOf(state));
  }
  function setSpeed(s) { speed = Math.max(0.1, Math.min(8, +s || 1)); }
  // The two floating brain maps (and their rings and labels) on or off.
  function setBrains(on) { for (const g of brainHolders) g.visible = !!on; }
  function stats() {
    let meshes = 0, tris = 0;
    scene.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      meshes++;
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    return {
      meshes, tris: Math.round(tris),
      cards: Z.hand[0].length + Z.hand[1].length + Z.grave[0].length + Z.grave[1].length + Z.perms.size + Z.held.filter(Boolean).length,
      hand: Z.hand.map(h => h.length), grave: Z.grave.map(g => g.length), perms: Z.perms.size,
      pips: Z.pips.size, busy: !!cur || queue.length > 0, fly: flies[0].mod.placeholder ? 'placeholder' : 'fly.js',
      brain: brains.map(Boolean), camera: camMode, shot: cam.shot, brainsShown: brainHolders[0].visible,
    };
  }
  function dispose() {
    disposed = true;
    clearCards();
    io?.disconnect(); controls?.dispose();
    for (const f of flies) { try { f.built?.dispose?.(); } catch { /* gone */ } }
    for (const b of brains) { try { b?.dispose?.(); } catch { /* gone */ } }
    scene.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); } } });
    W.tex.dispose(); W.sprites.dispose();
    renderer?.dispose();
  }

  return {
    play, setState, resize, render, dispose, setSpeed, setCamera, shoot, setBrains, ready, stats, camera, scene,
    world: { W, Z, flies, drums, piles, lights, get mirror() { return mirror; }, cam, director, brains },
  };
}

// ---------------------------------------------------------------- lights
function buildLights(scene, W, coarse) {
  const hemi = new THREE.HemisphereLight(0xbfcbe8, 0x2a1c12, 0.55);
  scene.add(hemi);
  // key: the lamp over the table, the only shadow light
  // cone wide enough to reach the flies on the stools; the felt is in the
  // bright centre of the cone
  const key = new THREE.SpotLight(0xffe6c4, 130, 24, 0.98, 0.5, 2);
  key.position.set(0, W.lampY - 0.25, 0);
  key.target.position.set(0, T.y, 0);
  key.castShadow = !coarse;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 1; key.shadow.camera.far = 12;
  scene.add(key, key.target);
  // rim: cool light from behind and above, at the side of the room
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.5);
  rim.position.set(-6, 8, -3);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffd2a8, 0.6);
  rim2.position.set(5, 5, 6);
  scene.add(rim2);
  return { hemi, key, rim, rim2 };
}
