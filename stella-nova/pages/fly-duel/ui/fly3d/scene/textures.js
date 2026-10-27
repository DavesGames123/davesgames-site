// ============================================================================
//  FLY DUEL 3D  ·  card face, back and mystery textures  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. textureCache() gives one CanvasTexture
//  per card id (drawCard of ui/cardface.js), the card back and the
//  question-mark back of a hidden card. Without a canvas (node) each
//  texture is null and the caller uses a flat colour.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'const FACE_PX'                 card face canvas size
//      grep -n 'function fontsReady'           wait for STIX Two Text
//      grep -n 'export function textureCache'  faces and back (ui/cardface.js)
//      grep -n 'function drawMystery'          the question-mark back
//      grep -n 'export const MYSTERY_GLYPH'    the glyph on the hidden card
// ============================================================================
import { CARD } from '../../../game/cards.js';
import { drawCard, cardBack, loadCardArt, getCardArt } from '../../cardface.js';
import { SANS } from '../../tokens.js';
import { makeCanvas, canvasTexture } from './canvas.js';

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
