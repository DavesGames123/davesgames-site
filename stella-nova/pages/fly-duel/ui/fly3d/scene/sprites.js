// ============================================================================
//  FLY DUEL 3D  ·  text sprites  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. spriteFactory() makes text sprites for
//  the damage numbers and the banners, cached by text and colour.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export function spriteFactory'  text on a sprite
// ============================================================================
import * as THREE from 'three';
import { TOKENS, SANS, MONO } from '../../tokens.js';
import { makeCanvas, canvasTexture } from './canvas.js';

// Text on a sprite (damage numbers, banners). Crisp: a dark outline, no
// glow. Cached by text and colour.
export function spriteFactory() {
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
