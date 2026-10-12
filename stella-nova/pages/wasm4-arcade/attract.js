// ============================================================================
//  WASM-4 ARCADE  ·  attract.js — the attract-mode reel and its autopilot
// ----------------------------------------------------------------------------
//  Pure code, no DOM: the saver (saver.js) and the node tests use it.
//
//    rng(seed)                  mulberry32, a seeded random in 0..1
//    planReel(carts, seed, n)   n shots: a seeded shuffle of the carts (all
//                               of them before one comes back, never the
//                               same cart twice in a row), each 6 to 12 s,
//                               with a skip (frames run with no picture
//                               before the shot, to pass the splash) and a
//                               kind: 'title' (no input) or 'play'
//    new Autopilot(seed, kind, input)
//      .step(frame) -> { pad, mx, my, mb }
//                               scripted input for one 60 Hz frame. 'title'
//                               presses nothing. 'play' taps X about every
//                               1.2 s (start, menus, actions) and holds a
//                               random direction for 1/3 to 1 s. A cart
//                               with input 'mouse' gets a pointer that
//                               drifts on a Lissajous path and drags.
//
//  grep -n targets  "export function planReel"  "export class Autopilot"
// ============================================================================
import { BUTTON_X, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_UP, BUTTON_DOWN } from './runtime/constants.js';

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planReel(carts, seed, n = 24) {
  const r = rng(seed), out = [];
  let bag = [], last = null;
  while (out.length < n) {
    if (!bag.length) {
      bag = carts.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag.length > 1 && bag[0].id === last) bag.push(bag.shift());
    }
    const c = bag.shift();
    const kind = r() < 0.3 ? 'title' : 'play';
    const dur = 6 + Math.floor(r() * 7);
    const skip = kind === 'title' ? Math.max(0, (c.labelFrame || 60) - 40) : Math.floor(30 + r() * 60);
    out.push({ id: c.id, kind, dur, skip, seed: Math.floor(r() * 1e9), input: c.input || 'pad' });
    last = c.id;
  }
  return out;
}

const DIRS = [BUTTON_LEFT, BUTTON_RIGHT, BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT | BUTTON_UP, BUTTON_RIGHT | BUTTON_DOWN, 0];

export class Autopilot {
  constructor(seed, kind = 'play', input = 'pad') {
    this.r = rng(seed); this.kind = kind; this.input = input;
    this.dir = 0; this.dirLeft = 0; this.nextTap = 50 + Math.floor(this.r() * 30);
    this.ph = this.r() * 6.28; this.drag = 0;
  }
  step(frame) {
    const o = { pad: 0, mx: 0x7fff, my: 0x7fff, mb: 0 };
    if (this.kind === 'title') return o;
    if (frame >= this.nextTap) {
      if (frame < this.nextTap + 4) o.pad |= BUTTON_X;
      else this.nextTap = frame + 50 + Math.floor(this.r() * 40);
    }
    if (frame > 60) {
      if (--this.dirLeft <= 0) { this.dir = DIRS[Math.floor(this.r() * DIRS.length)]; this.dirLeft = 20 + Math.floor(this.r() * 40); }
      o.pad |= this.dir;
    }
    if (this.input === 'mouse') {
      const t = frame / 60 + this.ph;
      o.mx = Math.round(80 + 55 * Math.sin(t * 0.9)); o.my = Math.round(80 + 55 * Math.sin(t * 1.3 + 1));
      if (--this.drag <= -40) this.drag = 30 + Math.floor(this.r() * 30);
      o.mb = this.drag > 0 ? 1 : 0;
    }
    return o;
  }
}
