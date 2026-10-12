// ============================================================================
//  FLY DUEL 3D  ·  the saver reel kit  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  The screensaver (saver.js createReel3d) films each match as a cut reel.
//  The scene director (ui/fly3d/director.js) has the wide, over and combat
//  shots. This kit adds the other shots of the reel as camera paths
//  ("rigs") and the reel props that are not part of a match:
//
//    rig shots   cold (a push through the crowd), decks, shuffle, hands,
//                brain (one mushroom body, close), duo (both maps), card
//                (follows the cast card), mana (the land stacks), d20 (the
//                life die), dolly (onto the attackers), crane, crowd,
//                lethal (low angle at the attack that ends the match),
//                victory (the winner, front), slump (the loser), recap.
//    deck fans   the key cards of the two decks, fanned in front of the
//                camera (drawCard of ui/cardface.js), with the deck names
//    riffle      a riffle shuffle of card backs on each library pile
//    title card  a flat panel in front of the camera; the saver draws it
//                (saver.js drawRecap)
//
//  The rig takes the camera through scene.setRig (a saver hook in
//  ui/fly3d/scene.js). rigPose() is pure apart from three.js vectors, so
//  the node test checks each pose: the subject is in the frame and no fly,
//  card or table is between the camera and the subject.
//
//  Clear band. The shell plate covers the top and the bottom of the frame.
//  frame(band, w, h) moves the image with camera.setViewOffset so that the
//  look point of the shot sits in the middle of the clear band, and opens
//  the view a little when the band is short. The overlays (fans, title
//  card) are laid out in the band in camera space and use no offset.
//
//  Look: flat colours, MeshBasicMaterial on the overlays (no tone map, no
//  light), hard edges. No glow, no blur. Reduced motion: the rigs hold
//  still (k = 0.5), the fans and the riffle do not move.
//
//  API
//      seatPoint(p, u, y, v, out?)       seat space -> world (as scene.js)
//      RIGS                              rig shot names
//      rigPose(kind, k, ctx, out) -> out | null
//        ctx: { p, aspect, variant, brain: [V3|null, V3|null], target: V3 |
//          null, die: [V3, V3], fan: [V3|null, V3|null] }
//        out: { pos, look, focus, fov }
//      createReelKit(sceneApi, { coarse, reduced }) -> { rig(kind, p, o),
//        release(), fan(decks), title(draw), clearOverlay(), shuffle(on),
//        frame(band, w, h), subject(w, h), update(dt), shot, dispose() }
//
//  GREP MAP
//      grep -n 'export function seatPoint'     seat space -> world
//      grep -n 'export function rigPose'       every rig camera path
//      grep -n 'function fanMeshes'            the deck fans
//      grep -n 'function riffle'               the shuffle
//      grep -n 'function titleMesh'            the title card panel
//      grep -n 'export function createReelKit'
// ============================================================================
import * as THREE from 'three';
import { TABLE } from './scene.js';
import { CROWD_SECTOR } from './hall.js';
import { drawCard, loadCardArt, getCardArt } from '../cardface.js';
import { TOKENS, FLY, SANS } from '../tokens.js';

const T = TABLE;
const TALL = 0.95;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

// Seat space (u to the right of the seat seen from the centre, y above
// the table top, v toward the seat) -> world. The same rule as scene.js.
export function seatPoint(p, u, y, v, out = new THREE.Vector3()) {
  return p === 0 ? out.set(u, T.y + y, v) : out.set(-u, T.y + y, -v);
}

export const RIGS = ['cold', 'decks', 'shuffle', 'hands', 'brain', 'duo', 'card', 'mana', 'd20', 'dolly', 'crane', 'crowd', 'lethal', 'victory', 'slump', 'recap'];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// One camera path. k: 0..1 over the shot. Returns out, or null when the
// shot has no subject (no brain map yet): the caller then uses 'wide'.
// focus: where the crowd looks (the table centre on crowd shots).
export function rigPose(kind, k, ctx, out) {
  const p = ctx.p === 1 ? 1 : 0, q = 1 - p;
  const aspect = ctx.aspect || 1.6, tall = aspect < TALL;
  const fit = Math.max(1, 1.45 / aspect);
  const vr = ctx.variant ?? 0.5;
  const e = ease(k);
  const side = p === 0 ? 1 : -1;               // seat 0 looks to -z: +x is its right
  out.fov = tall ? 50 : 40;
  out.focus = null;
  const centre = _d.set(0, T.y + 0.3, 0);
  switch (kind) {
    case 'cold': {
      // over the heads of the crowd toward the table (crowd heads are
      // under y 3.5, the ring is 7.4 to 10.8 out)
      const a = (CROWD_SECTOR[0] + CROWD_SECTOR[1]) / 2 + (vr - 0.5) * 1.4;
      const r = lerp(13.5, 6.4, e) * (tall ? 1.2 : 1);
      out.pos.set(Math.sin(a) * r, lerp(3.9, 5.2, e), Math.cos(a) * r);
      out.look.set(0, T.y + lerp(0.9, 0.4, e), 0);
      out.focus = centre.clone();
      out.fov = tall ? 56 : 44;
      return out;
    }
    case 'decks': case 'recap': {
      // under the overlay: a slow orbit high over the table
      const r = (kind === 'recap' ? 10 : 11) * Math.min(fit, 1.3), el = kind === 'recap' ? 0.9 : 0.72;
      const az = Math.PI / 2 + 0.6 * (vr - 0.5) + 0.25 * k;
      out.look.set(0, T.y, 0);
      out.pos.set(Math.sin(az) * Math.cos(el) * r, T.y + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
      return out;
    }
    case 'shuffle': {
      seatPoint(p, T.deckU, 0.12, T.deckV, out.look);
      const d = lerp(1.0, 0.8, e) * (tall ? 1.35 : 1);
      seatPoint(p, T.deckU - 0.75 * d, 1.15 * d, T.deckV - 1.55 * d, out.pos);
      out.fov = tall ? 46 : 36;
      return out;
    }
    case 'hands': {
      // high over the head of the fly, down onto the faces of its fan
      if (ctx.fan && ctx.fan[p]) out.look.copy(ctx.fan[p]); else seatPoint(p, 0, 0.68, 3.33, out.look);
      seatPoint(p, 0.55, lerp(3.7, 3.3, e), lerp(4.75, 4.45, e), out.pos);
      if (tall) out.pos.lerp(out.look, -0.25);
      out.fov = tall ? 52 : 42;
      return out;
    }
    case 'brain': {
      const b = ctx.brain && ctx.brain[p];
      if (!b) return null;
      // from the table side of the map, a slow arc around it
      _a.set(-b.x, 0, -b.z); if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0); _a.normalize();
      const az = (vr - 0.5) * 0.8 + 0.5 * (e - 0.5);
      const c = Math.cos(az), s = Math.sin(az);
      _b.set(_a.x * c - _a.z * s, 0, _a.x * s + _a.z * c);
      const dist = 2.5 * (tall ? 1.3 : 1);
      out.look.copy(b).add(_c.set(0, -0.25, 0));
      out.pos.copy(b).addScaledVector(_b, dist).add(_c.set(0, 0.35, 0));
      out.fov = tall ? 48 : 38;
      return out;
    }
    case 'duo': {
      const b0 = ctx.brain && ctx.brain[0], b1 = ctx.brain && ctx.brain[1];
      if (!b0 || !b1) return null;
      if (tall) {
        // along the line of the two maps, from behind map A
        out.look.copy(b0).lerp(b1, 0.55);
        out.pos.copy(b0).add(_c.set(1.4, 1.3, 3.2));
        out.fov = 54;
        return out;
      }
      const mid = _a.copy(b0).add(b1).multiplyScalar(0.5);
      const half = b0.distanceTo(b1) / 2;
      const hf = Math.atan(Math.tan((40 * Math.PI) / 360) * aspect);
      const dist = (half / Math.tan(hf)) * 1.3;
      // from the side of the table away from the maps
      _b.set(-mid.x, 0, -mid.z); if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0); _b.normalize();
      const az = (vr - 0.5) * 0.3 + 0.12 * (e - 0.5), c = Math.cos(az), s = Math.sin(az);
      out.look.copy(mid);
      out.pos.copy(mid).add(_c.set((_b.x * c - _b.z * s) * dist, 1.1, (_b.x * s + _b.z * c) * dist));
      return out;
    }
    case 'card': {
      if (ctx.target) out.look.copy(ctx.target); else seatPoint(p, T.stageU, T.stageY, T.stageV, out.look);
      // from the centre side (the face of a held card looks there)
      const d = tall ? 1.4 : 1;
      out.pos.copy(out.look).add(_c.set(0.55 * side * d, 0.75 * d, (p === 0 ? -1.7 : 1.7) * d));
      out.pos.y = Math.max(out.pos.y, T.y + 0.45);
      out.fov = tall ? 48 : 38;
      return out;
    }
    case 'mana': {
      seatPoint(p, 0, 0.1, T.landV, out.look);
      seatPoint(p, 1.1, lerp(1.35, 1.05, e), T.landV - lerp(2.3, 1.8, e) * (tall ? 1.3 : 1), out.pos);
      return out;
    }
    case 'd20': {
      if (ctx.die && ctx.die[p]) out.look.copy(ctx.die[p]).add(_c.set(0, 0.18, 0)); else seatPoint(p, T.lifeU, 0.18, T.lifeV, out.look);
      const d = lerp(1.0, 0.8, e) * (tall ? 1.35 : 1);
      // seat space offset from the die, toward the centre and to its right
      seatPoint(p, T.lifeU + 0.55 * d, 0.85 * d, T.lifeV - 1.25 * d, out.pos);
      out.fov = tall ? 46 : 36;
      return out;
    }
    case 'dolly': {
      if (ctx.target) _a.copy(ctx.target); else seatPoint(p, 0, 0, T.attackV, _a);
      const d = lerp(6.0, 3.4, e) * fit;
      // from the defending side: back, a little to the side, up
      _b.set(0.55 * side, 0.62, p === 0 ? -0.8 : 0.8).normalize();
      out.look.copy(_a).setY(T.y + 0.15);
      out.pos.copy(out.look).addScaledVector(_b, d);
      return out;
    }
    case 'crane': {
      const az = Math.PI / 2 + (p === 0 ? -0.5 : 0.5) + (vr - 0.5) * 0.4, r = lerp(6.5, 3.3, e) * fit, h = lerp(3.0, 9.0, e);
      out.look.set(0, T.y, 0);
      out.pos.set(Math.sin(az) * r, T.y + h, Math.cos(az) * r);
      return out;
    }
    case 'crowd': {
      // from above the table out to the crowd; the crowd looks at the table
      const a = (CROWD_SECTOR[0] + CROWD_SECTOR[1]) / 2 + (p === 0 ? -0.45 : 0.45) + (vr - 0.5) * 0.3;
      out.look.set(Math.sin(a) * 9, 2.6, Math.cos(a) * 9);
      const r = lerp(2.6, 1.9, e);
      out.pos.set(Math.sin(a) * r, T.y + 1.25, Math.cos(a) * r);
      out.focus = centre.clone();
      out.fov = tall ? 56 : 44;
      return out;
    }
    case 'lethal': {
      // low over the mat of the defender, up at the attackers and the fly
      seatPoint(p, 0, 1.25, T.seatV - 0.2, _a);
      if (ctx.target) _b.copy(ctx.target); else seatPoint(p, 0, 0, T.attackV, _b);
      out.look.copy(_b).lerp(_a, 0.5);
      seatPoint(q, (q === 0 ? -1 : 1) * lerp(1.25, 0.95, e), 0.34 + (tall ? 0.5 : 0), lerp(1.75, 1.25, e) + (tall ? 1.1 : 0), out.pos);
      out.fov = tall ? 54 : 44;
      return out;
    }
    case 'victory': {
      if (ctx.p !== 0 && ctx.p !== 1) {
        // a draw: both flies from the side
        out.look.set(0, T.y + 0.8, 0);
        out.pos.set(lerp(9.5, 8.2, e) * fit, T.y + 2.2, (vr - 0.5) * 2);
        return out;
      }
      seatPoint(p, 0, 0.95, T.seatV - 0.1, out.look);
      seatPoint(p, lerp(0.95, 0.5, e) * (vr < 0.5 ? 1 : -1), lerp(1.1, 0.9, e), T.seatV - lerp(2.8, 2.15, e) * (tall ? 1.3 : 1), out.pos);
      out.fov = tall ? 50 : 40;
      return out;
    }
    case 'slump': {
      seatPoint(p, 0, 0.6, T.seatV, out.look);
      seatPoint(p, 1.75 * (vr < 0.5 ? 1 : -1), lerp(0.55, 0.42, e), T.seatV - lerp(2.0, 1.65, e) * (tall ? 1.3 : 1), out.pos);
      out.fov = tall ? 50 : 40;
      return out;
    }
    default: return null;
  }
}

// ------------------------------------------------------------ canvases
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  return null;
}
function texOf(cv) {
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function flatMat(map, colour = 0xffffff, opacity = 1) {
  return new THREE.MeshBasicMaterial({ map: map || null, color: map ? 0xffffff : colour, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
}

// One deck fan: { group, cards: [{ mesh, home }], label }. Each card is a
// 5:7 plane with the painted card of ui/cardface.js on it.
function fanMeshes(deck, { coarse }) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1.4);
  const PX = coarse ? 220 : 320;
  const cards = (deck.cards || []).slice(0, 5).map((card, i, all) => {
    const cv = makeCanvas(PX, Math.round(PX * 1.4));
    const tex = texOf(cv);
    const draw = () => {
      if (!cv) return;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      try { drawCard(g, card, { w: cv.width, h: cv.height, art: getCardArt(card.id) }); } catch { /* the face stays blank */ }
      if (tex) tex.needsUpdate = true;
    };
    draw();
    if (cv) loadCardArt(card.id).then(img => { if (img) draw(); }, () => {});
    const mesh = new THREE.Mesh(geo, flatMat(tex, 0x2a2f3a));
    mesh.renderOrder = 1001 + i;
    group.add(mesh);
    const n = all.length, off = i - (n - 1) / 2;
    return { mesh, off, i, tex };
  });
  // the label under the fan: seat colour bar, deck name, colours
  const LW = coarse ? 512 : 768, LH = Math.round(LW / 6);
  const lcv = makeCanvas(LW, LH);
  if (lcv) {
    const g = lcv.getContext('2d');
    g.fillStyle = TOKENS.panel; g.fillRect(0, 0, LW, LH);
    g.fillStyle = FLY[deck.who] || TOKENS.ink; g.fillRect(0, 0, LH * 0.12, LH);
    const cols = deck.colours || [];
    cols.forEach((c, k) => { g.fillStyle = c; g.fillRect(LW - (cols.length - k) * LH * 0.32, 0, LH * 0.3, LH * 0.14); });
    g.fillStyle = TOKENS.ink; g.textBaseline = 'middle';
    g.font = `650 ${Math.round(LH * 0.42)}px ${SANS}`;
    g.fillText(deck.name || '', LH * 0.4, LH * 0.42);
    g.fillStyle = TOKENS.dim; g.font = `500 ${Math.round(LH * 0.22)}px ${SANS}`;
    g.fillText(`${deck.flyName || ''}${deck.colourNames ? ' · ' + deck.colourNames : ''}`, LH * 0.4, LH * 0.8);
    g.strokeStyle = TOKENS.hair2; g.lineWidth = 2; g.strokeRect(1, 1, LW - 2, LH - 2);
  }
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1, LH / LW), flatMat(texOf(lcv), 0x111623));
  label.renderOrder = 1010;
  group.add(label);
  return { group, cards, label, geo, labelAspect: LH / LW };
}

// A riffle shuffle on one library pile: N card backs in two halves that
// lift, bow and fall in turn into one stack. One cycle is RIFFLE_S long.
const RIFFLE_S = 1.7;
function riffle(W, at, yaw, n) {
  const group = new THREE.Group();
  group.position.copy(at); group.rotation.y = yaw;
  const geo = new THREE.BoxGeometry(T.cardW * 0.98, T.cardT, T.cardH * 0.98);
  const mats = [W.edgeMat, W.edgeMat, W.backMat, W.edgeMat, W.edgeMat, W.edgeMat];
  const cards = [];
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(geo, mats);
    m.castShadow = true;
    group.add(m);
    cards.push(m);
  }
  const pose = (t, still) => {
    const ph = still ? 1 : (t % RIFFLE_S) / RIFFLE_S;
    for (let k = 0; k < n; k++) {
      const m = cards[k], h = k % 2, j = k >> 1;       // half h, place j in it
      const stackY = 0.004 + k * T.cardT * 1.1;
      const lift = ease(ph / 0.32);
      const fallAt = 0.34 + 0.48 * (k / n);
      const fall = ph < fallAt ? 0 : ease((ph - fallAt) / 0.07);
      const sgn = h ? 1 : -1;
      const ux = sgn * 0.36 * lift, uy = 0.004 + j * T.cardT * 1.1 + 0.16 * lift, rz = -sgn * 0.42 * lift;
      m.position.set(lerp(ux, 0, fall), lerp(uy, stackY, fall), 0);
      m.rotation.set(0, 0, lerp(rz, 0, fall));
    }
  };
  return { group, pose, dispose() { geo.dispose(); } };
}

// The title card: one plane in camera space with a canvas the saver
// draws. Redrawn when the band size changes.
function titleMesh() {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flatMat(null, 0x0b0e15, 0.94));
  mesh.renderOrder = 1020;
  return { mesh, cv: null, tex: null, w: 0, h: 0 };
}

// ------------------------------------------------------------ the kit
export function createReelKit(sc, { coarse = false, reduced = false } = {}) {
  const W = sc.world, camera = sc.camera, scene = sc.scene;
  const overlay = new THREE.Group(); overlay.name = 'reel-overlay'; overlay.visible = false;
  scene.add(overlay);
  // a dark plane behind the overlays, so the cards read over the table
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flatMat(null, 0x05070c, 0.62));
  shade.renderOrder = 1000; overlay.add(shade);
  let fans = [], title = null, drawTitle = null, rif = null, rifT = 0, t = 0;
  let band = null, size = { w: 960, h: 540 };
  const shot = { kind: null, p: 0, t: 0, len: 8, info: null, variant: 0.5, overlay: false };
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), focus: null, fov: 40 };
  const ctx = { p: 0, aspect: 1.6, variant: 0.5, brain: [null, null], target: null, die: [null, null], fan: [null, null] };
  const tgt = new THREE.Vector3(); let tgtOk = false;
  const look = new THREE.Vector3(), pos = new THREE.Vector3();
  const OVER_D = 2;    // overlay depth in front of the camera

  // the world point a card shot follows: the held card, then the permanent
  function cardTarget(info, p, o) {
    const Z = W.Z;
    const held = Z.held[p];
    if (held && (!info || !info.card || held.id === info.card)) return o.copy(held.mesh.position);
    if (info && info.uid != null && Z.perms.get(info.uid)) return o.copy(Z.perms.get(info.uid).mesh.position);
    if (info && info.uids) {
      o.set(0, 0, 0); let n = 0;
      for (const u of info.uids) { const x = Z.perms.get(u); if (x) { o.add(x.mesh.position); n++; } }
      if (n) return o.multiplyScalar(1 / n);
    }
    return null;
  }
  function fillCtx() {
    ctx.p = shot.p; ctx.aspect = camera.aspect || 1.6; ctx.variant = shot.variant;
    for (let p = 0; p < 2; p++) {
      const b = W.brains && W.brains[p];
      ctx.brain[p] = b && b.group ? b.group.getWorldPosition(ctx.brain[p] || new THREE.Vector3()) : null;
      ctx.die[p] = W.drums && W.drums[p] ? (ctx.die[p] || new THREE.Vector3()).copy(W.drums[p].grp.position) : null;
      const H = W.Z.hand[p];
      if (H && H.length) { const v = ctx.fan[p] || new THREE.Vector3(); v.set(0, 0, 0); for (const o of H) v.add(o.mesh.position); ctx.fan[p] = v.multiplyScalar(1 / H.length); } else ctx.fan[p] = null;
    }
    const want = ['card', 'dolly', 'lethal'].includes(shot.kind) ? cardTarget(shot.info, shot.p, _a) : null;
    if (want) {
      if (!tgtOk || reduced) tgt.copy(want); else tgt.lerp(want, 0.12);
      tgtOk = true;
    }
    ctx.target = tgtOk ? tgt : null;
  }
  // the rig of the scene hook: place the camera for this frame
  function rigFn(cam, dt, camState) {
    shot.t += dt;
    const k = reduced ? 0.5 : clamp(shot.t / Math.max(0.1, shot.len), 0, 1);
    fillCtx();
    let r = rigPose(shot.kind, k, ctx, out);
    if (!r) r = rigPose('crane', 0.3, ctx, out);
    if (camera.fov !== out.fov) { camera.fov = out.fov; camera.updateProjectionMatrix(); }
    if (shot.cut || reduced) { pos.copy(out.pos); look.copy(out.look); shot.cut = false; }
    else { const a = 1 - Math.exp(-dt * 9); pos.lerp(out.pos, a); look.lerp(out.look, a); }
    camera.position.copy(pos); camera.lookAt(look);
    camState.look.copy(out.focus || look);
    camState.pos.copy(pos);
    placeOverlay();
  }

  function placeOverlay() {
    camera.updateMatrixWorld();
    overlay.position.copy(camera.position);
    overlay.quaternion.copy(camera.quaternion);
    if (!overlay.visible) return;
    // the band in plane units at depth OVER_D (no view offset on overlay shots)
    const visH = 2 * OVER_D * Math.tan((camera.fov * Math.PI) / 360) / (camera.zoom || 1), visW = visH * (camera.aspect || 1.6);
    const H = size.h, Wd = size.w, u = visH / H;
    const top = band ? band.t : 0, bot = band ? band.b : 0, bw = band ? Math.min(Wd, band.w) : Wd;
    const bh = Math.max(H * 0.3, H - top - bot);
    const cy = (H / 2 - (top + bh / 2)) * u, bwU = bw * u * 0.94, bhU = bh * u * 0.92;
    shade.position.set(0, 0, -OVER_D - 0.01); shade.scale.set(visW * 1.02, visH * 1.02, 1);
    if (fans.length) layoutFans(cy, bwU, bhU);
    if (title) layoutTitle(cy, bwU, bhU, bw, bh);
  }
  function layoutFans(cy, bw, bh) {
    const wide = bw >= bh * 1.1;
    const n = fans.length;
    fans.forEach((F, d) => {
      // a fan per deck: side by side when wide, stacked when tall
      const cellW = wide ? bw / n : bw, cellH = wide ? bh : bh / n;
      const cx = wide ? -bw / 2 + cellW * (d + 0.5) : 0;
      const ccy = wide ? cy : cy + bh / 2 - cellH * (d + 0.5);
      const labH = Math.min(cellW * F.labelAspect, cellH * 0.18), labW = labH / F.labelAspect;
      const ch = Math.min(cellH - labH * 1.4, (cellW / 3.3) * 1.4) * 0.95, cw = ch / 1.4;
      F.label.scale.set(labW, labW, 1);
      F.label.position.set(cx, ccy - cellH / 2 + labH * 0.6, -OVER_D);
      const pivotY = ccy - cellH / 2 + labH * 1.3 + ch * 0.5 - ch * 1.6;
      F.cards.forEach(c => {
        const delay = reduced ? 0 : 0.25 + d * 0.45 + c.i * 0.12;
        const a = reduced ? 1 : ease((t - F.t0 - delay) / 0.55);
        const ang = -c.off * 0.17 * a;
        const r = ch * 1.6;
        const x = cx + Math.sin(-ang) * r * 0.9, y = pivotY + Math.cos(ang) * r;
        c.mesh.scale.set(cw, cw, 1);
        c.mesh.position.set(x, lerp(y - ch * 1.2, y, a), -OVER_D + 0.001 * c.i);
        c.mesh.rotation.set(0, (1 - a) * 0.9, ang);
        c.mesh.material.opacity = a;
      });
    });
  }
  function layoutTitle(cy, bwU, bhU, bwPx, bhPx) {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const pw = Math.round(Math.min(1600, bwPx * 0.94 * dpr)), ph = Math.round(Math.min(1100, bhPx * 0.92 * dpr));
    if (drawTitle && (Math.abs(pw - title.w) > 8 || Math.abs(ph - title.h) > 8)) {
      title.w = pw; title.h = ph;
      if (!title.cv) title.cv = makeCanvas(pw, ph);
      if (title.cv) {
        title.cv.width = pw; title.cv.height = ph;
        const g = title.cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        try { drawTitle(g, pw / dpr, ph / dpr); } catch (e) { console.warn('fly-duel saver: title card', e); }
        if (!title.tex) { title.tex = texOf(title.cv); title.mesh.material.map = title.tex; title.mesh.material.color.set(0xffffff); title.mesh.material.opacity = 1; title.mesh.material.needsUpdate = true; }
        title.tex.needsUpdate = true;
      }
    }
    title.mesh.scale.set(bwU, bhU, 1);
    title.mesh.position.set(0, cy, -OVER_D);
    const a = reduced ? 1 : ease((t - title.t0) / 0.5);
    title.mesh.material.opacity = (title.tex ? 1 : 0.94) * a;
  }

  function clearOverlay() {
    for (const F of fans) { overlay.remove(F.group); F.cards.forEach(c => { c.tex?.dispose(); c.mesh.material.dispose(); }); F.geo.dispose(); F.label.material.map?.dispose(); F.label.material.dispose(); F.label.geometry.dispose(); }
    fans = [];
    if (title) { overlay.remove(title.mesh); title.tex?.dispose(); title.mesh.material.dispose(); title.mesh.geometry.dispose(); title = null; drawTitle = null; }
    overlay.visible = false;
    shot.overlay = false;
    applyBand();
  }

  // decks: [{ name, who, flyName, colours: [hex], colourNames, cards: [card] }]
  function fan(decks) {
    clearOverlay();
    fans = decks.map(d => { const F = fanMeshes(d, { coarse }); F.t0 = t; overlay.add(F.group); return F; });
    overlay.visible = true; shot.overlay = true;
    applyBand();
    placeOverlay();
  }
  function titleCard(draw) {
    clearOverlay();
    title = titleMesh(); title.t0 = t; drawTitle = draw;
    overlay.add(title.mesh);
    overlay.visible = true; shot.overlay = true;
    applyBand();
    placeOverlay();
  }

  function shuffle(on) {
    if (on && !rif) {
      // the riffle runs on top of the library pile (the scene sets the
      // pile height each frame, so the pile stays under it)
      rif = [0, 1].map(p => {
        const pile = W.piles && W.piles[p];
        const h = pile && pile.lib.visible ? pile.lib.scale.y : 0;
        const at = seatPoint(p, T.deckU, h + 0.004, T.deckV);
        const R = riffle(W, at, p === 0 ? 0 : Math.PI, coarse ? 10 : 16);
        R.group.name = 'reel-riffle';
        scene.add(R.group);
        return R;
      });
      rifT = 0;
    } else if (!on && rif) {
      for (const R of rif) { scene.remove(R.group); R.dispose(); }
      rif = null;
    }
  }

  // The clear band of the plate: move the image so the look point of a
  // rig or scene shot sits in its middle; open the view when it is short.
  function applyBand() {
    const H = size.h, Wd = size.w;
    if (!band || shot.overlay) { if (camera.view && camera.view.enabled) camera.clearViewOffset(); if (camera.zoom !== 1) { camera.zoom = 1; camera.updateProjectionMatrix(); } return; }
    const bh = Math.max(H * 0.3, H - band.t - band.b), yc = band.t + bh / 2;
    camera.setViewOffset(Wd, H, 0, Math.round(H / 2 - yc), Wd, H);
    const z = clamp(bh / (H * 0.78), 0.74, 1);
    if (Math.abs(camera.zoom - z) > 1e-3) { camera.zoom = z; camera.updateProjectionMatrix(); }
  }
  function frame(b, w, h) {
    size = { w: Math.max(1, w), h: Math.max(1, h) };
    band = b && Number.isFinite(b.t) && Number.isFinite(b.b) ? b : null;
    applyBand();
  }

  // the subject on screen (CSS px) for the plate anchor
  function subject(w, h) {
    if (shot.overlay) {
      const top = band ? band.t : 0, bot = band ? band.b : 0, bh = Math.max(h * 0.3, h - top - bot);
      return { x: w / 2, y: top + bh / 2, w: (band ? Math.min(w, band.w) : w) * 0.9, h: bh * 0.9 };
    }
    let pt = null;
    if (shot.kind) pt = _c.copy(look);
    else { const s = W.shotSubject ? W.shotSubject() : null; pt = s || _c.set(0, T.y, 0); }
    camera.updateMatrixWorld();
    const v = _b.copy(pt).project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    // NDC of the full frame: the view offset is in the projection
    return { x: (v.x * 0.5 + 0.5) * w, y: (0.5 - v.y * 0.5) * h, w: w * 0.4, h: h * 0.35 };
  }

  return {
    get shot() { return shot; },
    overlay,
    // take the camera for one rig shot. o: { len, info, variant }
    rig(kind, p = 0, o = {}) {
      shot.kind = kind; shot.p = p; shot.t = 0; shot.len = o.len || 8; shot.info = o.info || null;
      shot.variant = o.variant ?? 0.5; shot.cut = true; tgtOk = false;
      sc.setRig(rigFn);
    },
    release() { if (shot.kind) { shot.kind = null; sc.setRig(null); } },
    fan, title: titleCard, clearOverlay, shuffle, frame, subject,
    update(dt) {
      t += dt;
      if (rif) { rifT += dt; for (const R of rif) R.pose(rifT, reduced); }
      if (overlay.visible && !shot.kind) placeOverlay();
    },
    dispose() {
      clearOverlay(); shuffle(false);
      try { sc.setRig(null); } catch { /* scene gone */ }
      scene.remove(overlay); shade.geometry.dispose(); shade.material.dispose();
      if (camera.view && camera.view.enabled) camera.clearViewOffset();
    },
  };
}
