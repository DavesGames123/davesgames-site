// ============================================================================
//  HOLOCLOTH  ·  decals.js
//  Ported from upstream src/decals.ts (github.com/dmitrykurash/holocloth).
//  Copyright (c) 2026 Dmitry Kurash, MIT License, see LICENSE.
//  Port changes: TypeScript types are removed. On a coarse pointer the
//  canvas long side is 1024 px, not 2048 px, to save phone GPU memory.
//
//  UV-space compositor for the cloth image and the stickers (decals).
//    grep -n 'hitTest'   the topmost decal under a UV point
//    grep -n 'redraw'    draw the cloth image and the decals
// ============================================================================
import * as THREE from 'three';

// A decal item is { img, u, v, scale, rotation }:
//   u, v      center position in cloth UV space (u right, v up)
//   scale     decal width as a fraction of cloth width
//   rotation  degrees
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
const LONG_SIDE = COARSE ? 1024 : 2048;

/**
 * UV-space surface compositor: an optional full-bleed cloth image plus any
 * number of decal images, drawn into one canvas that the cloth material
 * samples. Because everything lives in UV space, graphics deform with the
 * cloth for free.
 */
export class SurfaceLayer {
  constructor() {
    this.decals = [];
    this.clothImage = null;
    this.selected = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = LONG_SIDE;
    this.canvas.height = LONG_SIDE;
    this.ctx = this.canvas.getContext('2d');
    // recreated when the canvas is resized — re-read after setAspect()
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.redraw();
  }

  /**
   * Resize backing canvas to match the cloth aspect so texels stay square.
   * Returns true when the GPU texture had to be recreated (the old storage
   * cannot change dimensions) — the caller must re-bind `texture`.
   */
  setAspect(aspect) {
    const w = aspect >= 1 ? LONG_SIDE : Math.round(LONG_SIDE * aspect);
    const h = aspect >= 1 ? Math.round(LONG_SIDE / aspect) : LONG_SIDE;
    if (this.canvas.width === w && this.canvas.height === h) {
      this.redraw();
      return false;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.redraw();
    return true;
  }

  addDecal(img) {
    const item = { img, u: 0.5, v: 0.5, scale: 0.35, rotation: 0 };
    this.decals.push(item);
    this.selected = item;
    this.redraw();
    return item;
  }

  setClothImage(img) {
    this.clothImage = img;
    this.redraw();
  }

  clear() {
    this.decals = [];
    this.clothImage = null;
    this.selected = null;
    this.redraw();
  }

  /** Topmost decal whose (rotated) rect contains the uv point, else null. */
  hitTest(u, v) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const px = u * W;
    const py = (1 - v) * H;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const { w, h } = this.decalPixelSize(d);
      const cx = d.u * W;
      const cy = (1 - d.v) * H;
      const a = (-d.rotation * Math.PI) / 180;
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return d;
    }
    return null;
  }

  decalPixelSize(d) {
    const W = this.canvas.width;
    const iw = d.img.naturalWidth || d.img.width || 300;
    const ih = d.img.naturalHeight || d.img.height || 300;
    const w = d.scale * W;
    const h = (w * ih) / iw;
    return { w, h };
  }

  redraw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.clothImage) {
      ctx.drawImage(this.clothImage, 0, 0, canvas.width, canvas.height);
    }
    for (const d of this.decals) {
      const { w, h } = this.decalPixelSize(d);
      ctx.save();
      ctx.translate(d.u * canvas.width, (1 - d.v) * canvas.height);
      ctx.rotate((d.rotation * Math.PI) / 180);
      ctx.drawImage(d.img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
