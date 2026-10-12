// ============================================================================
//  FLY DUEL 3D  ·  the table scene  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  Two fruit flies sit on folding chairs at a long folding table in a
//  card convention hall (ui/fly3d/hall.js) and play the real match. ui/match.js makes one record per decision. play(record) turns the
//  record into timed steps (ui/fly3d/choreo.js) and plays them: cards go
//  from the fan to the table, lands turn and dim when tapped, mana tokens
//  go from the lands to the card, creatures attack and block, damage
//  numbers rise, dead creatures go to the graveyard.
//
//  Look (FLY3D.md): crisp and well lit. One shadow light (the overhead
//  key of the hall panels), cool and warm rim lights and a hemisphere
//  fill. ACES tone mapping, sRGB. No bloom, no blur, no fog.
//
//  Hall. Each fly has its playmat, a deck box and its life on a d20
//  (ui/fly3d/d20.js createLifeDice, at TABLE.lifeU / lifeV). A crowd of
//  cheap flies stands around the table, its heads follow the camera
//  look point, and it reacts on the hold steps (big plays) and on the
//  win. Other flies play fake games at the other tables.
//
//  Dice. A roll step (record.rolls) throws a real Dice Lab die on the mat
//  of the fly (ui/fly3d/dice3d.js, Rapier when it loads, else a scripted
//  tumble), and the engine value comes up. A permanent with counters
//  carries a small d6 (a d20 over 6) per counter kind.
//
//  Cards: every face is drawCard() of ui/cardface.js on a 5:7 canvas, the
//  painted plate card of section 01. The face is drawn again when its
//  picture (loadCardArt) and the STIX font load. The back of every card,
//  the deck and the hand of the other fly show cardBack().
//
//  World units: the table top is at y = TABLE.y, the table is
//  2 halfLen long (x) and 2 halfDepth deep (z). Seat 0
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
//  Play mode: the map of the other fly is big, behind its chair, and
//  faces the camera (grep -n 'big brain'). The map of your seat hides.
//
//  The brain map floats beside the head of its fly, not inside the head:
//  in a head capsule the map is too small to read at the wide shot, and it
//  would hide the eyes, which carry the character of the fly.
//
//  API
//      createDuelScene(canvas, { connectomes, cards, names, reduced,
//        coarse, headless }) -> { play(record) -> Promise, setState(state),
//        resize(), render(dt), dispose(), setSpeed(s), setCamera(mode),
//        shoot(shot, p), setBrains(on), ready, stats(), world,
//        setFirstPerson(seat | null), pickPermanent(x, y), pickCard(x, y),
//        orbitBy(dx, dy), zoomBy(k), seatView(),
//        highlight(ids, kind) | highlight(spec) | highlight(null),
//        setRig(fn | null) }
//      Saver hook: setRig(fn) gives the camera to the saver reel
//      (ui/fly3d/reel.js). Each frame fn(camera, dt, cam) puts the camera
//      in place and sets cam.look (the crowd looks there). setRig(null)
//      gives the camera back to the director. shoot(shot, p, { cut: true })
//      jumps to the shot, also when the shot is an 'ease' shot.
//      Play mode (ui/play/play.js): setFirstPerson puts the camera at the
//      seat of the human (above and behind the fly's head, its own mat and
//      the other fly in view) and holds it there. pickPermanent and
//      pickCard take client px (a pointer event) and raycast the cards.
//      highlight marks legal attackers, blockers and targets with rings.
//      orbitBy(dx, dy), zoomBy(k), seatView(): the player turns and zooms
//      the seat camera (clamped, ui/fly3d/director.js ORBIT) and goes
//      back to the seat. ui/play/orbit.js gives the pointer gestures.
//      Hidden cards: in first person the hand and the library of the
//      other fly show the question-mark back (textureCache mystery) on
//      both caps. The mesh then has no card id, and pickCard gives id
//      null for it. A lifted card is public (it is played) and shows its
//      face. Watch mode shows every face.
//      setCamera: 'auto' (the steps pick the shots), 'wide', 'free' (the
//      user orbits, no cuts), 'script' (only shoot() cuts). Shots
//      (ui/fly3d/director.js SHOTS): wide, over, close, follow, dolly,
//      combat, crane, low, crowd, win, seat.
//      canvas null or headless: true builds the scene graph without a
//      renderer (node tests).
//
//  GREP MAP
//      grep -n 'export const TABLE'           table and layout numbers
//      grep -n 'function seatPos'             seat space -> world
//      grep -n 'const FACE_PX'                card face canvas size
//      grep -n 'function fontsReady'          wait for STIX Two Text
//      grep -n 'function textureCache'        faces and back (ui/cardface.js)
//      grep -n 'function cardGeometry'        chamfered card mesh
//      grep -n 'class CardObj'                one card on the table
//      grep -n 'setHidden(on)'                question-mark caps, no id
//      grep -n 'function drawMystery'         the question-mark back
//      grep -n 'function hiddenSeat'          whose hand is hidden
//      ui/fly3d/hall.js buildHall             hall, folding table, mats,
//                                             chairs, crowd, other tables
//      grep -n 'function buildLights'         key, rim, fill
//      grep -n 'function placeholderBuildFly' stand-in fly
//      grep -n 'function placeholderAnimate'  stand-in clips
//      grep -n 'function layout'              where every card goes
//      grep -n 'const STEP'                   one handler per choreo op
//      grep -n 'function shotPose'            camera place per shot
//      grep -n 'function shotSubject'         what a shot looks at (tests)
//      grep -n 'function setRig'              saver hook: the reel camera
//      grep -n 'export function createDuelScene'
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CARD } from '../../game/cards.js';
import { PALETTE, colourKey } from '../art.js';
import { drawCard, cardBack, loadCardArt, getCardArt } from '../cardface.js';
import { TOKENS, FLY, SANS, MONO } from '../tokens.js';
import { choreograph, mirrorOf, applyStep, mirrorDiff } from './choreo.js';
import { landProduces, colourHex, tokenShape, stackLayout, STACK } from './mana.js';
import { buildHall, HALL, CROWD_SECTOR, MAT } from './hall.js';
import { createDirector, recordInfo, SHOTS, orbitFrom, orbitPos, orbitDrag, orbitZoom } from './director.js';
import { createLifeDice } from './d20.js';
import { createDice } from './dice3d.js';

// ------------------------------------------------------------ dimensions
export const TABLE = {
  y: 2.0, thick: 0.09, halfLen: 4.6, halfDepth: 3.45,
  cardW: 0.56, cardH: 0.784, cardT: 0.008,
  landV: 2.2, creatureV: 1.2, attackV: 0.48, rowHalf: 1.75,
  deckU: 2.35, deckV: 1.35, graveU: 2.35, graveV: 0.45,
  lifeU: -2.52, lifeV: 1.12, lifeSize: 0.27,
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

function canvasTexture(cv, { srgb = true, aniso = 8 } = {}) {
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// The card shape: the elytron plate of ui/cardface.js. The top corners
// are cut at 45 degrees (chamfer = 7 % of the width), the bottom corners
// are round (radius = 5 % of the width). Counter-clockwise points.
function cardOutline(W, H, arcSeg = 4) {
  const c = 0.07 * W, r = 0.05 * W, x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2;
  const pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= arcSeg; i++) { const a = a0 + (a1 - a0) * i / arcSeg; pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } };
  arc(x1 - r, y0 + r, -Math.PI / 2, 0);
  pts.push(new THREE.Vector2(x1, y1 - c), new THREE.Vector2(x1 - c, y1), new THREE.Vector2(x0 + c, y1), new THREE.Vector2(x0, y1 - c));
  arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return pts;
}

// ------------------------------------------------------------ card face
// The card faces and the card back come from ui/cardface.js (drawCard,
// cardBack): the same painted plate cards as the DOM cards of section 01.
// One canvas per card id, 5:7. FACE_PX[0] is the desktop size, so a
// close-up shot stays sharp. FACE_PX[1] is the phone size (less texture
// memory). The texture has mipmaps, so the wide shot does not shimmer.
const FACE_PX = [[360, 504], [256, 358]];
// The card text is STIX Two Text (lib/sci.css). A canvas does not wait
// for a web font: it draws the fallback serif. fontsReady() resolves when
// the three faces of the card text are loaded (or at once without a DOM).
let fontsPromise = null;
function fontsReady() {
  if (fontsPromise) return fontsPromise;
  const fs = typeof document !== 'undefined' ? document.fonts : null;
  if (!fs?.load) return (fontsPromise = Promise.resolve(false));
  const fam = "'STIX Two Text'";
  fontsPromise = Promise.all([`500 20px ${fam}`, `600 20px ${fam}`, `italic 400 20px ${fam}`].map(f => fs.load(f).catch(() => null)))
    .then(() => true, () => false);
  return fontsPromise;
}

// --------------------------------------------------------- texture cache
// face(id) -> CanvasTexture or null (node: no canvas, the caller uses a
// flat colour). The face is drawn at once with the placeholder picture,
// then again when the font loads and when loadCardArt() resolves.
export function textureCache({ coarse = false } = {}) {
  const faces = new Map();
  let back = null;
  const all = [];
  const [FW, FH] = FACE_PX[coarse ? 1 : 0];
  const small = FW < 300;
  function face(id) {
    if (faces.has(id)) return faces.get(id);
    const card = CARD[id] || { id, name: id, type: 'spell', colour: 'none', cost: {} };
    const cv = makeCanvas(FW, FH);
    const g = cv?.getContext?.('2d');
    let tex = null;
    if (g) {
      const paint = () => {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, FW, FH);
        drawCard(g, card, { w: FW, h: FH, art: getCardArt(id, { small }) });
        if (tex) tex.needsUpdate = true;
      };
      paint();
      tex = canvasTexture(cv);
      tex.userData.repaint = paint;
      fontsReady().then(paint);
      loadCardArt(id, { small }).then(img => { if (img && faces.get(id) === tex) paint(); }).catch(() => {});
      all.push(tex);
    }
    faces.set(id, tex);
    return tex;
  }
  // One back for the deck, the hidden side of every card and the hand of
  // the other fly (the back material is on the back cap of each card).
  function backTex() {
    if (back !== null) return back;
    const cv = makeCanvas(FW, FH);
    const g = cv?.getContext?.('2d');
    if (g) {
      const paint = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, FW, FH); cardBack(g, { w: FW, h: FH }); if (back) back.needsUpdate = true; };
      paint();
      back = canvasTexture(cv);
      back.userData.repaint = paint;
      fontsReady().then(paint);
      all.push(back);
    } else back = undefined;
    return back;
  }
  // The hidden card (play mode): the card back with a big question mark.
  // Both caps of a hand card of the other fly and the top of its library
  // show it, so no camera angle shows a face (and the texture carries no
  // card id). Our own design, from cardBack().
  let mystery = null;
  function mysteryTex() {
    if (mystery !== null) return mystery;
    const cv = makeCanvas(FW, FH);
    const g = cv?.getContext?.('2d');
    if (g) {
      const paint = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, FW, FH); drawMystery(g, FW, FH); if (mystery) mystery.needsUpdate = true; };
      paint();
      mystery = canvasTexture(cv);
      mystery.userData.repaint = paint;
      mystery.userData.mystery = true;
      all.push(mystery);
    } else mystery = undefined;
    return mystery;
  }
  return { face, back: backTex, mystery: mysteryTex, size: [FW, FH], dispose() { for (const t of all) t.dispose(); faces.clear(); } };
}

// The question mark on the card back: a dark disc in the centre with a
// bronze ring and a big '?' (MYSTERY_GLYPH). Shared by the 3D hidden card.
export const MYSTERY_GLYPH = '?';
function drawMystery(g, w, h) {
  cardBack(g, { w, h });
  const r = Math.min(w, h) * 0.34, cx = w / 2, cy = h / 2;
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(10,8,5,0.88)'; g.fill();
  g.lineWidth = Math.max(2, r * 0.07); g.strokeStyle = '#c9a45a'; g.stroke();
  g.fillStyle = '#e8cf8a';
  g.font = `700 ${Math.round(r * 1.5)}px ${SANS}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(MYSTERY_GLYPH, cx, cy + r * 0.06);
  g.restore();
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
      map: face || null, color: face ? 0xffffff : new THREE.Color(PALETTE[colourKey(CARD[id]?.colour)]?.ink || TOKENS.none),
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
    this.hidden = false;
    W.cards.add(this.mesh);
  }
  // Hidden (play mode, a hand card of the other fly): both caps show the
  // question-mark back, and the mesh carries no card id.
  setHidden(on) {
    on = !!on;
    if (on === this.hidden) return;
    this.hidden = on;
    const ms = this.mesh.material;
    ms[0] = on ? this.W.mysteryMat : this.front;
    ms[1] = on ? this.W.mysteryMat : this.W.backMat;
    this.mesh.userData.card = on ? null : this.id;
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

// --------------------------------------------------------- mana tokens
// The tokens are thick (0.08) and large (a third of the card width or
// more), so the mana on each stack reads in the wide shot. Each colour of
// game/cards.js has its own prism (ui/fly3d/mana.js tokenShape: amber a
// honeycomb cell, moss a diamond, the other colours the next free shape)
// and its own hue (colourHex). Generic mana is a grey square. A token of
// a dual land is the prism of its first colour with an inset of the
// second colour on top.
// A dark hull behind each token (back faces, 1.16 times the size) gives
// a hard edge. Without it, an amber token on an amber land has almost
// no contrast. It is an outline, not a glow: no blur, no blend.
const TOKEN_HULL = 1.16;
const TOKEN_H = 0.08;
function tokenKit() {
  const geos = new Map(), mats = new Map();
  const hull = new THREE.MeshBasicMaterial({ color: new THREE.Color('#07080c'), side: THREE.BackSide });
  function geo(key) {
    const sides = key === 'generic' ? 0 : tokenShape(key);
    const k = 's' + sides;
    if (!geos.has(k)) {
      const r = sides === 0 ? 0 : sides === 3 ? 0.165 : sides === 4 ? 0.15 : 0.135;
      geos.set(k, sides === 0 ? new THREE.BoxGeometry(0.2, TOKEN_H, 0.2) : new THREE.CylinderGeometry(r, r, TOKEN_H, sides));
    }
    return geos.get(k);
  }
  function inset(key) {
    const sides = tokenShape(key) || 4, k = 'i' + sides;
    if (!geos.has(k)) { const r = 0.075; geos.set(k, new THREE.CylinderGeometry(r, r, TOKEN_H * 1.08, sides)); }
    return geos.get(k);
  }
  function mat(key) {
    if (!mats.has(key)) {
      const c = key === 'generic' ? TOKENS.none : colourHex(key);
      mats.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(c), emissive: new THREE.Color(c), emissiveIntensity: key === 'generic' ? 0.35 : 0.5, roughness: 0.35, metalness: 0.1 }));
    }
    return mats.get(key);
  }
  // A token mesh for a list of colours ([] or ['generic'] = generic).
  function make(colours) {
    const cs = colours && colours.length ? colours : ['generic'];
    const m = new THREE.Mesh(geo(cs[0]), mat(cs[0]));
    m.castShadow = true;
    const h = new THREE.Mesh(geo(cs[0]), hull);
    h.scale.setScalar(TOKEN_HULL); h.name = 'token-hull'; m.add(h);
    if (cs[1]) { const i = new THREE.Mesh(inset(cs[1]), mat(cs[1])); i.name = 'token-inset'; m.add(i); }
    m.userData.kind = cs.join('+');
    m.rotation.y = cs[0] === 'amber' ? Math.PI / 6 : 0;
    return m;
  }
  // Turn a token into a generic one (a token that pays a generic cost).
  function toGeneric(m) {
    m.geometry = geo('generic'); m.material = mat('generic'); m.userData.kind = 'generic';
    if (m.children[0]) m.children[0].geometry = geo('generic');
    for (const c of m.children) if (c.name === 'token-inset') c.visible = false;
  }
  // Show only the paid colour (a dual land that pays its second colour).
  function toColour(m, key) {
    m.geometry = geo(key); m.material = mat(key); m.userData.kind = key;
    if (m.children[0]) m.children[0].geometry = geo(key);
    for (const c of m.children) if (c.name === 'token-inset') c.visible = false;
  }
  function dispose() { for (const g of geos.values()) g.dispose(); for (const x of mats.values()) x.dispose(); hull.dispose(); }
  return { make, toGeneric, toColour, mat, geo, dispose };
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
    tex: textureCache({ coarse }), sprites: spriteFactory(),
    cardGeo: cardGeometry(), ringGeo: ringGeometry(),
    cards: new THREE.Group(),
    fx: new THREE.Group(),
  };
  W.cards.name = 'cards'; W.fx.name = 'fx';
  const backTex = W.tex.back();
  W.backMat = new THREE.MeshStandardMaterial({ map: backTex || null, color: backTex ? 0xffffff : 0x111623, roughness: 0.6 });
  W.edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.8 });
  const mysteryTex = W.tex.mystery();
  W.mysteryMat = new THREE.MeshStandardMaterial({ map: mysteryTex || null, color: mysteryTex ? 0xffffff : 0x1a1408, roughness: 0.6 });
  W.mysteryMat.userData.mystery = true;
  const hall = buildHall({
    coarse, reduced, seed: 7,
    layout: { y: T.y, halfLen: T.halfLen, halfDepth: T.halfDepth, seatV: T.seatV, seatTop: T.seatTop, seatPos: (p, u, y, v) => seatPos(p, u, y, v) },
  });
  W.inlay = hall.inlay; W.chairs = hall.chairs;
  scene.add(hall.group, W.cards, W.fx);

  // ---------------------------------------------------------- lights
  const lights = buildLights(scene, W, coarse);

  // ---------------------------------------------------------- piles
  const pileGeo = new THREE.BoxGeometry(T.cardW * 0.98, 1, T.cardH * 0.98); pileGeo.translate(0, 0.5, 0);
  // BoxGeometry face order: +x -x +y -y +z -z. The +y face shows the back
  // (the question mark on the library of the other fly in play mode).
  const pileMats = [W.backMat, W.mysteryMat].map(top => [W.edgeMat, W.edgeMat, top, W.edgeMat, W.edgeMat, W.edgeMat]);
  const piles = [0, 1].map(p => {
    const lib = new THREE.Mesh(pileGeo, pileMats[0]);
    lib.position.copy(seatPos(p, T.deckU, 0.008, T.deckV)); lib.quaternion.copy(seatQuat(p, 0, 0, 0));
    lib.castShadow = lib.receiveShadow = true;
    scene.add(lib);
    const label = W.sprites.make('0', TOKENS.ink2, 0.2);
    label.position.copy(seatPos(p, T.deckU, 0.5, T.deckV));
    scene.add(label);
    return { lib, label, n: -1 };
  });

  // ---------------------------------------------------------- life dice
  // Each fly keeps its life on a d20 on its mat (ui/fly3d/d20.js), with
  // a plate that shows the exact number. grp: the place of the dice.
  const drums = [0, 1].map(p => {
    const d = createLifeDice({ colour: FLY[p], size: T.lifeSize, reduced, label: p ? 'B' : 'A' });
    seatPos(p, T.lifeU, 0.006, T.lifeV, d.group.position);
    d.group.rotation.y = YAW[p];
    d.group.traverse(o => { if (o.isMesh) o.castShadow = !coarse; });
    scene.add(d.group);
    return { dice: d, grp: d.group, value: null };
  });

  // ---------------------------------------------------------- dice
  // Thrown dice (record.rolls) and counter dice (permanent.counters), from
  // the Dice Lab shapes and physics (ui/fly3d/dice3d.js).
  const dice = createDice({ reduced, coarse, physics: opts.dicePhysics !== false });
  scene.add(dice.group);
  const counterKeys = new Set();

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
      tableY: (T.y - T.seatTop) / flyScale, tableZ: (T.seatV - T.halfDepth) / flyScale,
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
  // The small map in the scene holds the lit KC->MBON edges at a low alpha
  // after the sequence. About 2000 lit edges meet at some 20 MBONs, so at
  // the standard hold alpha they made one solid wedge over the KCs and the
  // MBON gems. The live signal (spikes, full alpha) does not change.
  const HOLD_OUT = 0, REST_EDGES = 0.3;
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
  let tallFrame = false;
  function placeBrains(tall) {
    tallFrame = !!tall;
    for (let p = 0; p < 2; p++) {
      if (tall) seatPos(p, 0, 2.55, T.seatV + 0.05, brainHolders[p].position);
      else seatPos(p, p === 0 ? -2.4 : 2.4, 2.1, T.seatV - 0.35, brainHolders[p].position);
    }
  }
  placeBrains(false);
  // The ring and the label of each map (bigBrain moves them).
  const brainParts = [null, null];
  // ---------------------------------------------------------- big brain
  // Play mode: the map of the other fly is large, in the hall behind its
  // chair, and turns to face the camera. A wide frame puts it beside the
  // fly (screen left, BIG.wide), a tall frame above it (BIG.tall). It is
  // past the far edge of the table, so it never covers your hand or your
  // mat (tests/fly3d-bigbrain.test.mjs). It fires on each decision of the
  // fly with the real trace (the 'think' step). When the orbit takes the
  // camera to the far side of the table, the map hides: there it would
  // stand between the camera and the board.
  // Seat space of the other fly: u (+ = screen left from your seat),
  // y above the table top, dv behind its seat, scale of the 0.62 map.
  const BIG = { wide: { u: 2.3, y: 1.1, dv: 0.7, scale: 1.7 }, tall: { u: 0, y: 3.05, dv: 0.8, scale: 1.75 } };
  const BIG_TALL = 0.8;     // under this aspect: the tall seat pose and map
  // The place of the big map now. A wide frame near BIG_TALL moves the
  // map in toward the fly (u), so it stays in the frame.
  function bigSpec() {
    const a = camera.aspect || 1.6;
    if (a < BIG_TALL) return BIG.tall;
    return { ...BIG.wide, u: BIG.wide.u * Math.min(1, a / 1.05) };
  }
  let bigP = -1;
  function bigBrain() {
    const want = fpSeat == null || !brains[1 - fpSeat] ? -1 : 1 - fpSeat;
    for (let p = 0; p < 2; p++) {
      const g = brainHolders[p], parts = brainParts[p], big = p === want;
      if (big) {
        const b = bigSpec();
        seatPos(p, b.u, b.y, T.seatV + b.dv, g.position);
        g.scale.setScalar(b.scale);
        if (parts) { parts.ring.visible = false; parts.label.position.y = 0.7; }
      } else if (p === bigP || g.scale.x !== 1) {
        g.scale.setScalar(1); g.rotation.set(0, YAW[p], 0);
        if (parts) { parts.ring.visible = true; parts.label.position.y = -0.98; }
      }
    }
    if (bigP !== want) { bigP = want; placeBrains(tallFrame); if (want >= 0) bigBrainPlace(); }
    for (let p = 0; p < 2; p++) brainHolders[p].visible = p === want ? true : brainsOn && fpSeat == null;
  }
  // re-place the big map after placeBrains (a resize) moved it
  function bigBrainPlace() {
    if (bigP < 0) return;
    const b = bigSpec();
    seatPos(bigP, b.u, b.y, T.seatV + b.dv, brainHolders[bigP].position);
  }
  // Each frame: face the camera (a turn about +y only) and hide when the
  // camera is on the far side of the table.
  function bigBrainFrame() {
    if (bigP < 0) return;
    const g = brainHolders[bigP];
    const dx = camera.position.x - g.position.x, dz = camera.position.z - g.position.z;
    g.rotation.set(0, Math.atan2(dx, dz), 0);
    const own = 1 - bigP;      // your seat: +z for seat 0, -z for seat 1
    g.visible = (own === 0 ? camera.position.z : -camera.position.z) > 0;
  }
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
        const bm = mod.createBrainMap(c, { colour: FLY[p], size: 0.62, lite: coarse, reducedMotion: reduced, neuropil, holdOut: HOLD_OUT, restEdges: REST_EDGES });
        brainHolders[p].add(bm.group);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.01, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(FLY[p]) }));
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.82;
        brainHolders[p].add(ring);
        const label = W.sprites.make(`${names[p]} · model mushroom body`, TOKENS.ink2, 0.13, { size: 40 });
        label.position.y = -0.98; brainHolders[p].add(label);
        brainParts[p] = { ring, label };
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
    return mountBrains(brainMod).then(() => { if (!disposed) showBrains(); }).then(() => ({ fly: flyMod ? 'fly.js' : 'placeholder', brain: brains.some(Boolean) }));
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
    let u, v, y;
    if (land) {
      // lands: one stack per colour set (ui/fly3d/mana.js stackLayout)
      const L = stackOf(p).at.get(x.uid) || { u: 0, dv: 0, dy: 0 };
      u = L.u; v = T.landV + L.dv; y = 0.008 + L.dy;
    } else {
      const row = pl.battlefield.filter(y => CARD[y.id].type !== 'land');
      const slots = rowSlots(row.length, T.rowHalf, 0.68);
      const i = row.indexOf(x);
      u = slots[i] ?? 0; v = T.creatureV; y = 0.008 + i * 0.0012;
    }
    if (f.attacking) v = T.attackV;
    if (f.blocking != null) {
      const a = Z.perms.get(f.blocking);
      if (a) { const ap = a.toP; u = p === 0 ? ap.x : -ap.x; v = T.attackV; }
    }
    // tapped: turn a little (not 90 degrees, DESIGN.md 3.6) and come
    // 0.1 toward the seat.
    const turn = x.tapped ? -0.38 : 0;
    if (x.tapped && !f.attacking && !land) v += 0.08;
    seatPos(p, u, y, v, out);
    seatQuat(p, -Math.PI / 2, 0, turn, q);
    if (o) {
      o.dimTo = x.tapped ? (land ? 0.42 : 0.62) : 1;
      o.glowTo = land && !x.tapped ? 0.16 : 0;
      o.scaleTo = x.pp > 0 ? 1.12 : 1;
      const col = f.attacking ? FLY[p] : f.blocking != null ? FLY[p] : f.target ? TOKENS.dmg : hlColour(x.uid, p);
      o.ring.visible = !!col; if (col) o.ring.material.color.set(col);
      if (!f.attacking && hl.get(x.uid) === 'attack') o.scaleTo = Math.max(o.scaleTo, 1.06);
      updateBadge(o, x);
    }
    return out;
  }
  function gravePose(p, i, out = P, q = Qt) {
    const jit = ((i * 7919) % 13) / 13 - 0.5;
    seatPos(p, T.graveU + jit * 0.04, 0.008 + i * 0.007, T.graveV, out);
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
    seatPos(p, T.deckU, 0.008 + n * 0.007, T.deckV, out);
    seatQuat(p, Math.PI / 2, 0, 0, q);  // face down
    return out;
  }
  function layout(snap = false) {
    if (!mirror) return;
    for (let p = 0; p < 2; p++) {
      const pl = mirror.players[p];
      stacks[p] = stackLayout(pl.battlefield);
      updatePlates(p);
      const H = Z.hand[p];
      const secret = p === hiddenSeat();
      H.forEach((o, i) => {
        o.setHidden(secret);
        handPose(p, i, H.length); snap ? o.place(P, Qt) : o.target(P, Qt, 0.3, 0, true);
        o.scaleTo = T.handScale; o.dimTo = 1; o.glowTo = 0; o.ring.visible = false;
      });
      for (const x of pl.battlefield) { const o = Z.perms.get(x.uid); if (!o) continue; o.setHidden(false); permPose(p, x); snap ? o.place(P, Qt) : o.target(P, Qt, 0.35); }
      Z.grave[p].forEach((o, i) => { o.setHidden(false); gravePose(p, i); snap ? o.place(P, Qt) : o.target(P, Qt, 0.4); o.scaleTo = 1; o.dimTo = 1; o.glowTo = 0; o.ring.visible = false; if (o.badge) updateBadge(o, { id: 'x', dmg: 0, pp: 0 }); });
      if (Z.held[p]) { const o = Z.held[p]; o.setHidden(false); stagePose(p); snap ? o.place(P, Qt) : o.target(P, Qt, 0.4); o.scaleTo = 1; o.dimTo = 1; o.glowTo = 0; o.ring.visible = false; }
      // library pile height and count
      const n = pl.library;
      const pile = piles[p];
      pile.lib.scale.y = Math.max(0.0005, n * 0.007); pile.lib.visible = n > 0;
      pile.lib.material = pileMats[secret ? 1 : 0];
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
      // life dice
      const d = drums[p];
      if (d.value !== pl.life) { d.dice.set(pl.life, { instant: d.value == null || snap }); d.value = pl.life; }
    }
    // counter dice on permanents with counters
    const seen = new Set();
    for (let p = 0; p < 2; p++) for (const x of mirror.players[p].battlefield) {
      if (!x.counters) continue;
      const o = Z.perms.get(x.uid);
      dice.setCounters(x.uid, x.counters, o ? o.mesh : null); seen.add(x.uid); counterKeys.add(x.uid);
    }
    for (const k of counterKeys) if (!seen.has(k)) { dice.setCounters(k, null); counterKeys.delete(k); }
    // pips that lost their land
    for (const [uid, pip] of Z.pips) if (!Z.perms.has(uid) && !pip.userData.flying) { W.fx.remove(pip); Z.pips.delete(uid); }
  }

  // The dmg / pump badge on a creature: shows power / toughness left.
  function updateBadge(o, x) {
    const card = CARD[x.id] || { type: 'creature' };
    if (card.type !== 'creature') return;
    const pt = x.pt ?? x.pp, pc = x.pc | 0;
    const key = x.dmg || x.pp || pt || pc ? `${(card.power || 0) + x.pp + pc}/${(card.toughness || 0) + pt + pc - x.dmg}|${x.dmg}` : '';
    if (key === o.badgeKey) return;
    o.badgeKey = key;
    if (o.badge) { o.mesh.remove(o.badge); o.badge.material.map?.dispose(); o.badge.material.dispose(); o.badge = null; }
    if (!key) return;
    const cv = makeCanvas(160, 64);
    let tex = null;
    if (cv?.getContext) {
      const g = cv.getContext('2d');
      g.fillStyle = x.dmg || x.pp < 0 ? TOKENS.dmg : TOKENS.heal; g.fillRect(0, 0, 160, 64);
      g.fillStyle = TOKENS.bg; g.font = `700 44px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(key.split('|')[0], 80, 34);
      tex = canvasTexture(cv, { aniso: 4 });
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : new THREE.Color(x.dmg ? TOKENS.dmg : TOKENS.heal) }));
    m.position.set(T.cardW / 2 - 0.16, -T.cardH / 2 + 0.08, T.cardT / 2 + 0.003);
    o.mesh.add(m); o.badge = m;
  }

  // ---------------------------------------------------------- stacks
  // stacks[p]: stackLayout() of the battlefield of player p, made again on
  // each layout() pass. stackOf(p) makes it when layout() did not run yet.
  const stacks = [null, null];
  const stackOf = p => stacks[p] || (stacks[p] = stackLayout(mirror.players[p].battlefield));
  // A count plate lies on the mat at the head of each stack: the number
  // of lands in the stack and a bar in each colour of the stack.
  const plates = [new Map(), new Map()];
  const plateGeo = new THREE.PlaneGeometry(0.34, 0.15);
  function plateTex(n, colours) {
    const cv = makeCanvas(136, 60);
    if (!cv?.getContext) return null;
    const g = cv.getContext('2d');
    g.fillStyle = TOKENS.panel; g.fillRect(0, 0, 136, 60);
    const cs = colours.length ? colours : ['generic'];
    cs.forEach((c, i) => { g.fillStyle = c === 'generic' ? TOKENS.none : colourHex(c); g.fillRect(0, i * (60 / cs.length), 16, 60 / cs.length); });
    g.strokeStyle = TOKENS.hair2; g.lineWidth = 2; g.strokeRect(1, 1, 134, 58);
    g.fillStyle = TOKENS.ink; g.font = `700 40px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`\u00d7${n}`, 76, 32);
    return canvasTexture(cv, { aniso: 4 });
  }
  function updatePlates(p) {
    const L = stacks[p], have = plates[p], seen = new Set();
    for (const st of L.stacks) {
      seen.add(st.key);
      let pl = have.get(st.key);
      if (!pl) {
        const m = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(st.colours[0] ? colourHex(st.colours[0]) : TOKENS.none) }));
        m.name = 'stack-plate:' + st.key;
        W.fx.add(m);
        pl = { m, n: -1 };
        have.set(st.key, pl);
      }
      if (pl.n !== st.n) {
        pl.n = st.n;
        const t = plateTex(st.n, st.colours);
        if (t) { pl.m.material.map?.dispose(); pl.m.material.map = t; pl.m.material.color.set(0xffffff); pl.m.material.needsUpdate = true; }
      }
      seatPos(p, st.u, 0.004, T.landV - T.cardH / 2 - 0.11, pl.m.position);
      pl.m.quaternion.copy(seatQuat(p, -Math.PI / 2, 0, 0));
    }
    for (const [k, pl] of have) if (!seen.has(k)) { W.fx.remove(pl.m); pl.m.material.map?.dispose(); pl.m.material.dispose(); have.delete(k); }
  }

  const tok = tokenKit();
  // The place of the token of an untapped land: its slot in the tower at
  // the head of its stack.
  function pipPose(p, uid, out = new THREE.Vector3()) {
    const t = stackOf(p).tower.get(uid);
    if (!t) { const o = Z.perms.get(uid); return out.copy(o ? o.toP : seatPos(p, 0, 0, T.landV)).setY(T.y + 0.065); }
    return seatPos(p, t.u, 0.065 + t.y + 0.012, T.landV + t.dv, out);
  }
  function addPip(p, x) {
    const m = tok.make(landProduces(CARD[x.id]));
    m.userData = { ...m.userData, p, uid: x.uid, grow: W.reduced ? 1 : 0 };
    m.position.copy(pipPose(p, x.uid)); m.rotation.y += YAW[p];
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
      if (k > swapAt && pip.userData.kind !== pays) {
        if (pays === 'generic') tok.toGeneric(pip); else tok.toColour(pip, pays);
      }
      // the token gets smaller on the way: the cost rail slots are 0.1 apart
      const sc = k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1;
      pip.scale.setScalar((0.95 * sc + 0.05) * (1 - 0.5 * e));
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
  const restAnchor = p => seatPos(p, 0, 0.02, T.halfDepth - 0.15);
  const flyHead = p => seatPos(p, 0, 1.15, T.seatV - 0.15);

  // ---------------------------------------------------------- director
  // ui/fly3d/director.js picks the shot from the steps (createDirector,
  // onStep in runStep). shotPose() turns the shot into a camera place and
  // look point each frame. A 'cut' shot jumps there, an 'ease' shot moves
  // there at SHOTS[shot].rate. Reduced motion: every change is a cut.
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 120);
  const dir = createDirector({ reduced });
  const cam = {
    pos: new THREE.Vector3(), look: new THREE.Vector3(), wantPos: new THREE.Vector3(), wantLook: new THREE.Vector3(),
    az: 0.35, userUntil: -1,
    get shot() { return dir.state.shot; }, get p() { return dir.state.p; }, get since() { return dir.state.since; },
  };
  const TALL = 0.95;
  // Camera mode (setCamera): 'auto' lets the steps pick the shots;
  // 'wide' holds the wide shot; 'free' leaves the camera to the user's
  // orbit; 'script' takes shots only from shoot() (the saver director).
  let camMode = 'auto';
  let recInfo = { action: { type: 'pass' }, lethal: false, loser: -1 };
  function director(shot, p = 0, force = false) {
    if (camMode !== 'auto') return false;
    return dir.request(shot, p, sceneT, { force });
  }
  const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
  // The world point that a shot target names (null when it is gone).
  function targetPos(tg, out) {
    if (!tg) return null;
    if (tg.kind === 'held') { const o = Z.held[tg.p]; return o ? out.copy(o.mesh.position) : null; }
    if (tg.kind === 'perm') { const o = Z.perms.get(tg.uid); return o ? out.copy(o.mesh.position) : null; }
    if (tg.kind === 'uids') {
      out.set(0, 0, 0); let n = 0;
      for (const u of tg.uids) { const o = Z.perms.get(u); if (o) { out.add(o.mesh.position); n++; } }
      return n ? out.multiplyScalar(1 / n) : null;
    }
    return null;
  }
  const seatDir = (p, out) => out.set(0, 0, p === 0 ? 1 : -1);
  // First person at a seat (play mode): above and behind the head of the
  // fly at that seat, looking over its own mat to the other fly and its
  // big brain map (grep -n 'big brain'). SEAT_POSE is in seat space (y
  // above the table top, v toward the seat). The numbers come from a
  // search that made the other fly as large as possible with these
  // limits: the fly and its map in the frame, your creature row above
  // 70 % of the frame height (clear of the hand), your head under that
  // row, and the map above your mat. wide: aspect 1 and more. tall:
  // aspect 0.5 (a phone). Between, a linear mix (seatMix).
  // Before: a 48 deg view from just over the head; the map of the other
  // fly did not fit above it.
  const SEAT_POSE = { wide: { y: 2.2, v: 6.0, ly: 0, lv: -1.0, fov: 36 }, tall: { y: 4.2, v: 7.8, ly: 0.4, lv: -1.0, fov: 53 } };
  const seatTall = () => (camera.aspect || 1.6) < BIG_TALL;
  // A wide pose under aspect 1.1 opens its view a little, so the map
  // beside the fly stays in the frame.
  const seatVal = k => {
    const a = camera.aspect || 1.6;
    if (seatTall()) return k === 'fov' ? SEAT_POSE.tall.fov * Math.max(1, Math.sqrt(0.513 / a)) : SEAT_POSE.tall[k];
    return k === 'fov' ? SEAT_POSE.wide.fov * Math.max(1, Math.sqrt(1.1 / a)) : SEAT_POSE.wide[k];
  };
  let fpSeat = null;
  function seatPose(p, pos, look) {
    seatPos(p, 0, seatVal('y'), seatVal('v'), pos);
    seatPos(p, 0, seatVal('ly'), seatVal('lv'), look);
  }
  const shotK = (secs) => (W.reduced ? 1 : easeIO(Math.min(1, (sceneT - dir.state.since) / secs)));
  function shotPose(dt) {
    const aspect = camera.aspect || 1.6;
    const fit = Math.max(1, 1.45 / aspect);           // tall frames step back
    const st = dir.state;
    const s = speed > 2.5 && st.shot !== 'seat' ? 'wide' : st.shot;
    const P0 = st.p;
    // A tall frame (a phone, aspect < TALL) does not step back from the
    // side view: at 0.65 the camera went past the wall and each fly was
    // about 70 px high. The wide and combat shots look along the line
    // between the seats instead, so one fly is near and one is far.
    if (aspect < TALL && (s === 'wide' || s === 'win' || s === 'combat')) {
      const r = 13.5 * Math.max(1, 0.68 / aspect);
      let el = 0.55, az = 0.28, toward = 0.8;
      if (s === 'combat') { el = 0.75; az = P0 === 0 ? 0.3 : Math.PI + 0.3; toward = P0 === 0 ? 0.6 : -0.6; }
      else if (!W.reduced) { cam.az += dt * 0.05; az += 0.12 * Math.sin(cam.az); }
      cam.wantLook.set(0, T.y + 0.3, toward);
      cam.wantPos.set(Math.sin(az) * Math.cos(el) * r, T.y + 0.3 + Math.sin(el) * r, toward + Math.cos(az) * Math.cos(el) * r);
    } else if (s === 'wide' || s === 'win') {
      if (!W.reduced) cam.az += dt * (s === 'win' ? 0.12 : 0.05);
      const r = 10 * fit, el = 0.48;
      const az = Math.PI / 2 + 0.55 * Math.sin(cam.az);
      cam.wantLook.set(0, T.y + 0.5, 0);
      cam.wantPos.set(Math.sin(az) * Math.cos(el) * r, T.y + 0.5 + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    } else if (s === 'over') {
      // over the right shoulder of the fly, high enough to see its fan
      seatPos(P0, (P0 === 0 ? 2.0 : -2.0) * fit, 3.0, T.seatV + 0.9 * fit, cam.wantPos);
      seatPos(P0, -0.2, 0.25, T.seatV - 1.7, cam.wantLook);
    } else if (s === 'close') {
      // in front of the held card: the card face, the mana tokens and
      // the face of the fly behind it
      seatPos(P0, -0.35, 1.5, T.stageV - 2.2 * fit, cam.wantPos);
      if (!targetPos(st.target, cam.wantLook)) seatPos(P0, 0.3, T.stageY + 0.05, T.stageV + 0.35, cam.wantLook);
    } else if (s === 'follow') {
      // behind and above the seat side of the card, the card in the
      // middle of the frame while it goes from the hand to the mat
      if (!targetPos(st.target, cam.wantLook)) stagePose(P0, cam.wantLook);
      seatDir(P0, _t1);
      _t2.set(P0 === 0 ? 1 : -1, 0, 0);
      cam.wantPos.copy(cam.wantLook).addScaledVector(_t1, 2.4 * fit).addScaledVector(_t2, 1.3 * fit);
      cam.wantPos.y = Math.max(cam.wantLook.y, T.y) + 2.6 * fit;
    } else if (s === 'dolly') {
      // from the defending side, a slow push onto the attackers
      if (!targetPos(st.target, _t3)) seatPos(P0, 0, 0, T.attackV, _t3);
      const d = (6.2 - 3.0 * shotK(2.4)) * fit;
      seatDir(1 - P0, _t1); _t2.set(P0 === 0 ? -1 : 1, 0, 0);
      _t1.multiplyScalar(0.8).addScaledVector(_t2, 0.55).add(_t2.set(0, 0.62, 0)).normalize();
      cam.wantLook.copy(_t3).setY(T.y + 0.15);
      cam.wantPos.copy(cam.wantLook).addScaledVector(_t1, d);
    } else if (s === 'combat') {
      const side = P0 === 0 ? 1 : -1;
      cam.wantPos.set(7.6 * fit, T.y + 3.6, 1.2 * side);
      cam.wantLook.set(0, T.y + 0.1, 0);
    } else if (s === 'crane') {
      // a rise over the board: from a low three-quarter view to high above
      const k = shotK(3.2);
      const az = Math.PI / 2 + (P0 === 0 ? -0.5 : 0.5), r = (6.5 - 3.2 * k) * fit, h = 3.0 + 6.0 * k;
      cam.wantLook.set(0, T.y, 0);
      cam.wantPos.set(Math.sin(az) * r, T.y + h, Math.cos(az) * r);
    } else if (s === 'low') {
      // low over the mat of the loser, looking up at the attacking fly
      // over its attackers
      const att = P0, def = 1 - att;
      seatPos(att, 0, 1.25, T.seatV - 0.2, _t1);           // attacker head
      if (!targetPos(st.target, _t3)) seatPos(att, 0, 0, T.attackV, _t3);
      cam.wantLook.copy(_t3).lerp(_t1, 0.55);
      seatPos(def, (def === 0 ? -1.1 : 1.1), 0.32, 1.35 + 1.4 * (fit - 1), cam.wantPos);
      cam.wantPos.y = T.y + 0.32 + 0.6 * (fit - 1);
    } else if (s === 'crowd') {
      // from the table end, toward the middle of the crowd
      const a = (CROWD_SECTOR[0] + CROWD_SECTOR[1]) / 2 + (P0 === 0 ? -0.45 : 0.45);
      cam.wantLook.set(Math.sin(a) * 9, 2.8, Math.cos(a) * 9);
      cam.wantPos.set(Math.sin(a) * 2.2, T.y + 1.1, Math.cos(a) * 2.2);
    } else if (s === 'seat') {
      seatPose(fpSeat ?? P0, cam.wantPos, cam.wantLook);
      if (fpOrbit) orbitPos(fpOrbit, cam.wantLook, cam.wantPos);
    }
  }
  // The point a shot is about (tests: it must be in the frame).
  function shotSubject() {
    const st = dir.state, out = new THREE.Vector3();
    switch (st.shot) {
      case 'follow': case 'close': case 'dolly': return targetPos(st.target, out) || null;
      case 'low': return seatPos(st.p, 0, 1.15, T.seatV - 0.2, out);
      case 'over': return seatPos(st.p, 0, 0, T.creatureV, out);
      case 'crowd': { const a = (CROWD_SECTOR[0] + CROWD_SECTOR[1]) / 2 + (st.p === 0 ? -0.45 : 0.45); return out.set(Math.sin(a) * 9, 2.8, Math.cos(a) * 9); }
      case 'seat': return seatPos(1 - st.p, 0, 1.0, T.seatV - 0.2, out);
      default: return out.set(0, T.y, 0);
    }
  }
  // Cut to a shot now, in any mode but 'free' (the saver and the page).
  // o.cut: jump to the shot also when its move is 'ease' (a reel cut).
  function shoot(shot, p = 0, o = {}) {
    const r = dir.request(shot, p | 0, sceneT, { force: true });
    if (o && o.cut) dir.state.cut = true;
    return r;
  }
  // Saver hook (saver.js, ui/fly3d/reel.js). While camRig is set, it puts
  // the camera in place each frame and the director shot does not move it.
  // setRig(null) keeps the camera where the rig left it; the next shot
  // eases or cuts from there.
  let camRig = null;
  const _rd = new THREE.Vector3();
  function setRig(fn) {
    camRig = typeof fn === 'function' ? fn : null;
    if (!camRig) {
      cam.pos.copy(camera.position);
      camera.getWorldDirection(_rd);
      cam.look.copy(camera.position).addScaledVector(_rd, 8);
    }
    return !!camRig;
  }
  function setCamera(mode) {
    const m = ['auto', 'wide', 'free', 'script'].includes(mode) ? mode : 'auto';
    if (fpSeat != null) { fpPrev = m; return; }     // first person holds; the mode applies after it
    camMode = m;
    if (camMode === 'wide') shoot('wide');
    cam.userUntil = camMode === 'free' ? Infinity : now;
    if (camMode !== 'free') { cam.pos.copy(camera.position); if (controls) cam.look.copy(controls.target); }
  }
  const FOV = 40;                          // the seat shot: seatVal('fov')
  function updateCamera(dt) {
    if (camRig) {
      try { camRig(camera, dt, cam); } catch (e) { console.warn('fly-duel 3d: the saver rig failed', e); setRig(null); }
      if (controls) controls.target.copy(cam.look);
      return;
    }
    const fov = dir.state.shot === 'seat' ? Math.round(seatVal('fov') * 10) / 10 : FOV;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    shotPose(dt);
    if (now < cam.userUntil) return;
    if (dir.state.cut) { cam.pos.copy(cam.wantPos); cam.look.copy(cam.wantLook); dir.state.cut = false; }
    const rate = SHOTS[dir.state.shot]?.rate ?? 1.9;
    const k = W.reduced ? 1 : 1 - Math.exp(-dt * rate);
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
    },
    land(s) {
      const o = Z.held[s.p] || new CardObj(W, s.card);
      Z.held[s.p] = null; o.uid = s.uid; Z.perms.set(s.uid, o); o.next = { dur: s.dur, arc: 0.3 };
      const x = mirrorSlot(s.p, s.uid, s.card);
      clip(s.p, 'place', { target: x, contactAt: s.dur });
    },
    tap(s) {
      const o = Z.perms.get(s.uid);
      // The token that rises is the top token of the tower of this stack.
      // The token of the tapped land takes the place of the top one.
      let pip = Z.pips.get(s.uid);
      const L = stackOf(s.p), at = L.at.get(s.uid), st = at && L.stacks[at.stack];
      const topUid = st?.free?.length ? st.free[st.free.length - 1] : s.uid;
      const top = topUid !== s.uid ? Z.pips.get(topUid) : null;
      if (pip && top && !top.userData.flying) {
        Z.pips.set(topUid, pip); pip.userData.uid = topUid;
        pip = top;
      }
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
      const src = s.src != null ? Z.perms.get(s.src) : null;
      const o = src || Z.held[s.p];
      const a = o ? (src ? o.toP.clone().add(new THREE.Vector3(0, 0.1, 0)) : o.mesh.position.clone()) : stagePose(s.p).clone();
      const b = worldOfTarget(s.to);
      spark(a, b, PALETTE[colourKey(CARD[s.card]?.colour)]?.ink || TOKENS.ink, s.dur || 0.4);
      if (typeof s.to === 'number') { const f = Z.flags.get(s.to) || {}; f.target = true; Z.flags.set(s.to, f); }
      if (typeof s.to === 'string' && s.amount) { cur?.struck?.add(+s.to.slice(1)); floatNumber(`-${s.amount}`, TOKENS.dmg, drums[+s.to.slice(1)].grp.position.clone().add(new THREE.Vector3(0, 0.9, 0))); }
    },
    hurt(s) { const o = Z.perms.get(s.uid); if (o) floatNumber(`-${s.amount}`, TOKENS.dmg, o.toP.clone().add(new THREE.Vector3(0, 0.25, 0))); },
    pump(s) {
      const o = Z.perms.get(s.uid);
      if (!o) return;
      o.pulse = 1;
      const a = s.amount | 0, b = s.tough ?? a, sg = v => (v < 0 ? `${v}` : `+${v}`);
      floatNumber(`${sg(a)}/${sg(b)}`, a < 0 || b < 0 ? TOKENS.dmg : TOKENS.heal, o.toP.clone().add(new THREE.Vector3(0, 0.3, 0)), { height: 0.28 });
    },
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
      hall.react('lean', { side: s.p, strength: 0.55 });
    },
    block(s) {
      const touch = s.dur * 0.3;
      for (const [a, b] of s.pairs) { const f = Z.flags.get(b) || {}; f.blocking = a; Z.flags.set(b, f); const o = Z.perms.get(b); if (o) o.next = { dur: s.dur - touch, arc: 0.15, delay: touch }; }
      const first = Z.perms.get(s.pairs[0]?.[1]);
      if (first) clip(s.p, 'push', { target: first.toP, to: seatPos(s.p, 0, 0, T.attackV), contactAt: touch });
    },
    strike(s) {
      const o = Z.perms.get(s.from);
      const b = worldOfTarget(s.to);
      if (o) { const dir = b.clone().sub(o.toP); dir.y = 0; const len = Math.min(0.5, dir.length() * 0.45); dir.normalize(); o.lunge = { dir, len: W.reduced ? 0 : len, t: 0, dur: Math.max(0.2, s.dur) }; }
      if (typeof s.to === 'string') {
        const q = +s.to.slice(1);
        cur?.struck?.add(q);
        floatNumber(`-${s.amount}`, TOKENS.dmg, drums[q].grp.position.clone().add(new THREE.Vector3(0, 0.9, 0)));
        clip(q, 'slump', { dur: 0.6, until: 0.45 });   // a short flinch
      } else {
        const t = Z.perms.get(s.to);
        if (t) floatNumber(`-${s.amount}`, TOKENS.dmg, t.toP.clone().add(new THREE.Vector3(0, 0.25, 0)));
      }
    },
    life(s) {
      const d = s.to - s.from;
      if (!(cur?.struck?.has(s.p) && d < 0)) floatNumber(d > 0 ? `+${d}` : `${d}`, d > 0 ? TOKENS.heal : TOKENS.dmg, drums[s.p].grp.position.clone().add(new THREE.Vector3(0, 0.9, 0)));
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
      hall.react('cheer', { side: s.winner, strength: 1 });
    },
    // A hold after a big play: the crowd reacts (CROWD_REACT).
    hold(s) {
      const r = CROWD_REACT[s.reason];
      if (r) hall.react(r[0], { side: s.reason === 'lethal' || s.reason === 'hit' ? 1 - s.p : s.p, strength: r[1] });
    },
    beat() { /* the turn pause: the flies settle (the director holds) */ },
    trigger(s) {
      const o = s.uid != null ? Z.perms.get(s.uid) : null;
      const at = o ? o.toP.clone().add(new THREE.Vector3(0, 0.45, 0)) : flyHead(s.p).add(new THREE.Vector3(0, 0.7, 0));
      if (o) o.pulse = 1;
      banner(TRIGGER_WORD[s.when] ? `${TRIGGER_WORD[s.when]} \u00b7 ${s.kind}` : s.kind, FLY[s.p], at, 0.7);
    },
    ramp(s) {
      const o = new CardObj(W, s.card); o.uid = s.uid;
      libraryTop(s.p); o.place(P, Qt);
      o.next = { dur: s.dur, arc: 0.55 };
      Z.perms.set(s.uid, o);
    },
    bounce(s) {
      const o = Z.perms.get(s.uid);
      Z.perms.delete(s.uid); Z.flags.delete(s.uid);
      if (!o) { if (!s.token) Z.hand[s.p].push(new CardObj(W, s.card)); return; }
      o.ring.visible = false; o.lunge = null;
      if (s.token) {
        o.scaleTo = 0.01; let t = 0;
        addFx({ update(dt) { t += dt; if (t > (W.reduced ? 0 : s.dur)) { o.dispose(); return false; } return true; } });
        trackLoose(o);
      } else { o.uid = null; o.next = { dur: s.dur, arc: 0.6 }; Z.hand[s.p].push(o); if (o.badge) updateBadge(o, { id: 'x', dmg: 0, pp: 0 }); }
    },
    raise(s) {
      const i = mirror.players[s.p].graveyard.indexOf(s.card);
      const G = Z.grave[s.p];
      const o = i >= 0 && G[i] ? G.splice(i, 1)[0] : new CardObj(W, s.card);
      o.next = { dur: s.dur, arc: 0.6 }; o.pulse = 1;
      Z.hand[s.p].push(o);
    },
    tapped(s) { const o = Z.perms.get(s.uid); if (o) o.pulse = 1; },
    grow(s) {
      const o = Z.perms.get(s.uid);
      if (o) { o.pulse = 1; floatNumber(`+${s.amount}/+${s.amount}`, TOKENS.heal, o.toP.clone().add(new THREE.Vector3(0, 0.3, 0)), { height: 0.28 }); }
    },
    counters(s) { const o = Z.perms.get(s.uid); if (o) o.pulse = 1; },
    roll(s) {
      // a real die on the mat of the fly; the engine value comes up
      const at = seatPos(s.p, 0, 0.012, (MAT.v0 + MAT.v1) / 2);
      const seed = ((cur?.rec?.i ?? cur?.rec?.idx ?? 0) * 131 + (s.i | 0) * 17 + s.value * 7 + 1) >>> 0;
      dice.roll([{ die: s.die, value: s.value }], { p: s.p, at, yaw: YAW[s.p], seed }).then(() => {}, () => {});
      const o = s.uid != null ? Z.perms.get(s.uid) : null;
      if (o) o.pulse = 1;
    },
    sync() {
      const want = mirrorOf(cur.rec.after);
      const diff = mirrorDiff(mirror, want);
      if (diff.length) { console.warn('fly-duel 3d: mirror drift, snap', diff); snapTo(want); }
    },
  };
  const TRIGGER_WORD = { enter: 'enters', death: 'dies', upkeep: 'upkeep' };
  // hold reason -> crowd reaction and strength (ui/fly3d/hall.js react)
  const CROWD_REACT = { lethal: ['cheer', 1], hit: ['buzz', 0.9], deaths: ['gasp', 0.8], creature: ['lean', 0.7] };
  const loose = new Set();
  function trackLoose(o) { loose.add(o); }

  function runStep(s) {
    // hand and graveyard arrays follow the mirror; handlers that need the
    // old mirror (lift, discard) run before applyStep.
    const h = STEP[s.op];
    try { h?.(s); } catch (e) { console.warn('fly-duel 3d: step failed', s.op, e); }
    if (camMode === 'auto' && fpSeat == null) dir.onStep(s, sceneT, recInfo);
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
    recInfo = recordInfo(rec);
    if (plan.steps.some(x => x.op === 'roll' || x.op === 'counters')) dice.warm();
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
    bigBrainPlace();
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
    dice.update(sdt);
    for (const pip of Z.pips.values()) {
      const u = pip.userData;
      if (u.flying) continue;
      if (u.grow < 1) { u.grow = Math.min(1, u.grow + sdt * 4); pip.scale.setScalar(easeOut(u.grow)); }
      pipPose(u.p, u.uid, _v3);
      if (W.reduced || pip.position.distanceToSquared(_v3) > 9) pip.position.copy(_v3);
      else pip.position.lerp(_v3, 1 - Math.exp(-sdt * 12));
    }
    for (let p = 0; p < 2; p++) {
      drums[p].dice.update(sdt);
      W.inlay[p].color.set(p === toAct && winner == null ? FLY[p] : TOKENS.faint);
    }
    hall.update(sdt, { focus: dir.state.shot === 'crowd' ? _t1.set(0, T.y, 0) : cam.look });
    for (let p = 0; p < 2; p++) brains[p]?.update?.(dt);
    updateCamera(dt);
    bigBrainFrame();
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
    if (land) {
      const L = stackLayout([...pl.battlefield.filter(y => y.uid !== uid), { uid, id, tapped: false }]).at.get(uid);
      return seatPos(p, L.u, 0.01 + L.dy, T.landV + L.dv);
    }
    const row = pl.battlefield.filter(y => (CARD[y.id].type === 'land') === land && y.uid !== uid);
    const n = row.length + 1;
    const slots = rowSlots(n, T.rowHalf, land ? 0.62 : 0.68);
    return seatPos(p, slots[n - 1], 0.01, land ? T.landV : T.creatureV);
  }

  // ---------------------------------------------------------- play mode
  // setFirstPerson(seat): the camera sits at the seat of the human player
  // (the 'seat' shot of the director) and stays there; the steps make no
  // cuts and the orbit is off, so a tap picks a card. null: back to the
  // camera mode from before.
  let fpPrev = null;
  // The seat whose hand and library show the question mark: the other
  // fly in play mode, none in watch mode.
  function hiddenSeat() { return fpSeat == null ? -1 : 1 - fpSeat; }
  function setFirstPerson(seat) {
    if (seat === 0 || seat === 1) {
      if (fpSeat == null) fpPrev = camMode;
      fpSeat = seat; camMode = 'script'; fpOrbit = null;
      if (canvas?.style) canvas.style.touchAction = 'none';
      showBrains();
      dir.request('seat', seat, sceneT, { force: true });
      cam.userUntil = now;
      if (controls) controls.enabled = false;
    } else if (fpSeat != null) {
      fpSeat = null; fpOrbit = null;
      if (canvas?.style) canvas.style.touchAction = 'pan-y';
      camMode = fpPrev || 'auto'; fpPrev = null;
      showBrains();
      dir.request('wide', 0, sceneT, { force: true });
      if (controls) controls.enabled = true;
    }
    layout(false);       // the hidden hand changes with the seat at once
    return fpSeat;
  }
  // The play-mode orbit (ui/fly3d/director.js ORBIT): orbitBy(dx, dy)
  // turns the seat camera about the seat look point by a drag in px,
  // zoomBy(k) changes the distance, seatView() goes back to the seat. The
  // first call starts from the seat pose, so the camera does not jump.
  // Only in first person: in watch mode OrbitControls has the camera.
  let fpOrbit = null;
  const _oa = new THREE.Vector3(), _ob = new THREE.Vector3();
  function orbitStart() {
    if (fpSeat == null) return false;
    if (!fpOrbit) { seatPose(fpSeat, _oa, _ob); fpOrbit = orbitFrom(_oa, _ob); }
    return true;
  }
  function orbitBy(dx, dy) { if (!orbitStart()) return null; fpOrbit = orbitDrag(fpOrbit, +dx || 0, +dy || 0); return { ...fpOrbit }; }
  function zoomBy(k) { if (!orbitStart()) return null; fpOrbit = orbitZoom(fpOrbit, k); return { ...fpOrbit }; }
  function seatView() { fpOrbit = null; return fpSeat; }
  // Screen point (client px, as a pointer event gives) -> NDC.
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  function toNdc(x, y) {
    const r = canvas?.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: canvas?.clientWidth || 960, height: canvas?.clientHeight || 540 };
    if (!(r.width > 0 && r.height > 0)) return null;
    return _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }
  function castAt(x, y, objs) {
    const n = toNdc(x, y);
    if (!n) return null;
    camera.updateMatrixWorld();
    _ray.setFromCamera(n, camera);
    const hits = _ray.intersectObjects(objs, false);
    return hits[0] || null;
  }
  // A permanent under the point: { uid, id, seat, point } or null. A tap
  // on a fly or its life dice gives { uid: null, player: seat }.
  function pickPermanent(x, y) {
    const list = [], owner = new Map();
    for (let p = 0; p < 2; p++) for (const pe of mirror?.players[p].battlefield || []) { const o = Z.perms.get(pe.uid); if (o) { list.push(o.mesh); owner.set(o.mesh, { uid: pe.uid, id: pe.id, seat: p }); } }
    const h = castAt(x, y, list);
    if (h) return { ...owner.get(h.object), point: h.point.clone() };
    const bodies = [];
    for (let p = 0; p < 2; p++) { drums[p].grp.traverse(o => { if (o.isMesh) { o.userData.seat = p; bodies.push(o); } }); flies[p].built?.root.traverse(o => { if (o.isMesh && !o.isInstancedMesh) { o.userData.seat = p; bodies.push(o); } }); }
    const b = castAt(x, y, bodies);
    return b ? { uid: null, player: b.object.userData.seat, point: b.point.clone() } : null;
  }
  // A hand card under the point: { seat, index, id } or null.
  function pickCard(x, y) {
    const list = [], at = new Map();
    // a hidden card (the hand of the other fly in play mode) gives no id
    for (let p = 0; p < 2; p++) Z.hand[p].forEach((o, i) => { list.push(o.mesh); at.set(o.mesh, { seat: p, index: i, id: o.hidden ? null : o.id }); });
    const h = castAt(x, y, list);
    return h ? at.get(h.object) : null;
  }
  // highlight(ids, kind) or highlight(spec). kind: 'eligible' (can act),
  // 'attack', 'block', 'target', 'pending'. spec (ui/play/play.js): {
  // eligible, attackers, blocks: [[attacker, blocker]], targets, pending }.
  // highlight(null) clears every mark. A step mark (attacking, blocking,
  // a spell target) wins over a highlight mark.
  const HL_COLOUR = { eligible: TOKENS.ink2, attack: null, block: null, target: TOKENS.app, pending: TOKENS.ink };
  const hl = new Map();
  function highlight(a, kind) {
    if (a == null) { hl.clear(); return hl.size; }
    if (Array.isArray(a)) {
      const k = HL_COLOUR[kind] !== undefined ? kind : 'eligible';
      for (const [u, v] of [...hl]) if (v === k) hl.delete(u);
      for (const u of a) if (u != null) hl.set(u, k);
      return hl.size;
    }
    hl.clear();
    const add = (list, k) => { for (const u of list || []) if (u != null && u !== -1) hl.set(u, k); };
    add(a.eligible, 'eligible');
    add(a.targets, 'target');
    add(a.attackers, 'attack');
    const bl = Array.isArray(a.blocks) ? a.blocks : a.blocks && typeof a.blocks === 'object' ? Object.entries(a.blocks).map(([x, y]) => [+x, y]) : [];
    for (const q of bl) { if (Array.isArray(q)) { hl.set(q[1], 'block'); if (!hl.has(q[0])) hl.set(q[0], 'attack'); } }
    add(a.pending, 'pending');
    return hl.size;
  }
  const hlColour = (uid, seat) => { const k = hl.get(uid); return k == null ? null : HL_COLOUR[k] ?? FLY[seat]; };

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
  // The brain maps float beside the flies. In first person they hide:
  // the map of the human's seat sits between the camera and the hand, and
  // the scorecards already show the fly's brain. setBrains keeps the
  // watch-mode choice, and showBrains applies it when first person ends.
  let brainsOn = true;
  function showBrains() { bigBrain(); }
  function setBrains(on) { brainsOn = !!on; showBrains(); }
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
      pips: Z.pips.size, stacks: stacks.map(L => (L ? L.stacks.map(x => `${x.key}:${x.untapped}/${x.n}`) : [])), busy: !!cur || queue.length > 0, fly: flies[0].mod.placeholder ? 'placeholder' : 'fly.js',
      brain: brains.map(Boolean), camera: camMode, shot: cam.shot, brainsShown: brainHolders[0].visible, bigBrain: bigP, hall: hall.stats(), dice: dice.stats(),
      firstPerson: fpSeat, hidden: hiddenSeat(), orbit: fpOrbit ? { ...fpOrbit } : null, highlight: Object.fromEntries([...new Set(hl.values())].map(k => [k, [...hl.values()].filter(v => v === k).length])),
    };
  }
  function dispose() {
    disposed = true;
    clearCards();
    io?.disconnect(); controls?.dispose();
    for (const f of flies) { try { f.built?.dispose?.(); } catch { /* gone */ } }
    for (const b of brains) { try { b?.dispose?.(); } catch { /* gone */ } }
    scene.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); } } });
    W.tex.dispose(); W.sprites.dispose(); tok.dispose(); hall.dispose(); dice.dispose();
    for (const d of drums) d.dice.dispose();
    renderer?.dispose();
  }

  return {
    play, setState, resize, render, dispose, setSpeed, setCamera, shoot, setBrains, ready, stats, camera, scene,
    setFirstPerson, pickPermanent, pickCard, highlight, setRig, orbitBy, zoomBy, seatView,
    world: { W, Z, flies, drums, piles, lights, hall, dice, get mirror() { return mirror; }, cam, director, dir, shotSubject, get sceneT() { return sceneT; }, brains, ops: Object.keys(STEP) },
  };
}

// ---------------------------------------------------------------- lights
// The hall light: fluorescent panels over every table. A cool white
// hemisphere fill and one high key light (the only shadow light, its
// shadow box fits the feature table). A warm low rim from the camera
// side keeps the flies apart from the dark floor. Crisp: no bloom.
function buildLights(scene, W, coarse) {
  const hemi = new THREE.HemisphereLight(0xeef3ff, 0x2a2f3a, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xf4f7ff, 2.4);
  key.position.set(2.5, 14, 3.5);
  key.target.position.set(0, T.y, 0);
  key.castShadow = !coarse;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = -6.5; sc.right = 6.5; sc.top = 6.5; sc.bottom = -6.5; sc.near = 4; sc.far = 22;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9);
  rim.position.set(-6, 8, -5);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffe2c4, 0.55);
  rim2.position.set(7, 4, 6);
  scene.add(rim2);
  return { hemi, key, rim, rim2 };
}
