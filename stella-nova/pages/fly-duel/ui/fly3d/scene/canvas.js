// ============================================================================
//  FLY DUEL 3D  ·  canvas and canvas texture  (ES module, three.js r160, DOM optional)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. makeCanvas() gives a DOM canvas, an
//  OffscreenCanvas or null (node). canvasTexture() wraps a canvas in an sRGB
//  CanvasTexture, or gives null for no canvas.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export function makeCanvas'     DOM canvas, OffscreenCanvas or null
//      grep -n 'export function canvasTexture'  canvas -> CanvasTexture
// ============================================================================
import * as THREE from 'three';

// --------------------------------------------------------- canvas utils
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

export function canvasTexture(cv, { srgb = true, aniso = 8 } = {}) {
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
