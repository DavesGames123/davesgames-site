// ============================================================================
//  BREADBOARD LAB  ·  parts/labels.js — printed text and screens on models
// ----------------------------------------------------------------------------
//  IC markings, silkscreen pin names and instrument screens are canvas
//  textures. A browser has a canvas; node has none. So every function here
//  returns null when no canvas exists, and the models then build without the
//  text. Nothing breaks in node; the tests count geometry, not glyphs.
//
//  Fonts: Inter for words, the system mono stack for codes and numbers.
//  No other families (CONTRACT 0 names the ones the owner rejects).
//
//  GREP MAP
//    makeCanvas ............. OffscreenCanvas, else a DOM canvas, else null
//    UI_FONT / MONO_FONT .... the two stacks
//    labelTexture ........... one line (or lines) of text -> CanvasTexture
//    labelPlane ............. a flat quad carrying a label, for a part top
//    makeScreen ............. a canvas + 2D context + texture for a screen
// ============================================================================

export const UI_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export function makeCanvas(w, h) {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
  } catch { /* no canvas */ }
  return null;
}

// lines: string | string[]. opts: { w, h, color, bg, font:'ui'|'mono', weight, align }
export function labelTexture(THREE, lines, opts = {}) {
  const w = opts.w || 256, h = opts.h || 64;
  const cv = makeCanvas(w, h);
  if (!cv) return null;
  const g = cv.getContext('2d');
  if (!g) return null;
  const L = Array.isArray(lines) ? lines : [lines];
  g.clearRect(0, 0, w, h);
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = opts.color || '#e9e9e4';
  g.textAlign = opts.align || 'center';
  g.textBaseline = 'middle';
  const fam = opts.font === 'mono' ? MONO_FONT : UI_FONT;
  const lh = h / L.length;
  const size = Math.floor(lh * (opts.scale || 0.62));
  g.font = `${opts.weight || 600} ${size}px ${fam}`;
  const x = g.textAlign === 'left' ? 4 : g.textAlign === 'right' ? w - 4 : w / 2;
  L.forEach((s, i) => g.fillText(String(s), x, lh * (i + 0.5), w - 8));
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A quad of size w x d mm lying flat (+Y normal), text reading along +X.
// Returns null when there is no canvas.
export function labelPlane(THREE, lines, w, d, opts = {}) {
  const px = Math.max(64, Math.min(1024, Math.round(w * 24)));
  const py = Math.max(16, Math.min(512, Math.round(d * 24)));
  const tex = labelTexture(THREE, lines, { w: px, h: py, ...opts });
  if (!tex) return null;
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.userData.ownMaterial = true;
  return mesh;
}

// A screen the UI draws on: { canvas, ctx, texture } or null.
export function makeScreen(THREE, w, h) {
  const canvas = makeCanvas(w, h);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, texture };
}
