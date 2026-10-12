// ============================================================================
//  WASM-4 ARCADE  ·  input.js — keyboard, Gamepad API, touch pad, mouse
// ----------------------------------------------------------------------------
//  One Input object holds the four gamepad bytes and the mouse of the
//  console. main.js copies them into cart memory before each update.
//
//    keyboard   the key map of the official runtime (ui/app.ts):
//               player 1  arrows, X V Space Period = X, Z C Comma = Z
//               player 2  E S D F = up left down right, A Q = X,
//                         Tab ShiftLeft = Z
//               Keys reach the console only while input.armed is true
//               (after a tap or click on the cabinet or Play), so the
//               arrows still scroll the page before that. Escape disarms.
//    gamepads   navigator.getGamepads(), standard mapping only, as
//               upstream: d-pad or left stick, buttons 0 3 5 7 = X,
//               1 2 4 6 = Z. Pad n drives player n % 4.
//    touch pad  an 8-way d-pad element and X and Z buttons (data-btn);
//               pointer events, so several fingers work at once
//    mouse      pointer on the glass, mapped to 0..159 through the glass
//               rect (crt.js glassRect); left, right, middle buttons
//
//  grep -n targets  "export class Input"  "const KEYS"  "  pollPads("
//                   "  bindPad("  "  bindScreen("  "export function padBits"
// ============================================================================
import { BUTTON_X, BUTTON_Z, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_UP, BUTTON_DOWN } from './runtime/constants.js';

export const KEYS = {
  KeyX: [0, BUTTON_X], KeyV: [0, BUTTON_X], Space: [0, BUTTON_X], Period: [0, BUTTON_X],
  KeyZ: [0, BUTTON_Z], KeyC: [0, BUTTON_Z], Comma: [0, BUTTON_Z],
  ArrowUp: [0, BUTTON_UP], ArrowDown: [0, BUTTON_DOWN], ArrowLeft: [0, BUTTON_LEFT], ArrowRight: [0, BUTTON_RIGHT],
  KeyA: [1, BUTTON_X], KeyQ: [1, BUTTON_X], ShiftLeft: [1, BUTTON_Z], Tab: [1, BUTTON_Z],
  KeyE: [1, BUTTON_UP], KeyD: [1, BUTTON_DOWN], KeyS: [1, BUTTON_LEFT], KeyF: [1, BUTTON_RIGHT],
};

// Standard-mapping gamepad -> button bits (upstream ui/app.ts).
export function padBits(buttons, axes) {
  const on = i => !!(buttons[i] && buttons[i].pressed);
  let m = 0;
  if (on(12) || axes[1] < -0.5) m |= BUTTON_UP;
  if (on(13) || axes[1] > 0.5) m |= BUTTON_DOWN;
  if (on(14) || axes[0] < -0.5) m |= BUTTON_LEFT;
  if (on(15) || axes[0] > 0.5) m |= BUTTON_RIGHT;
  if (on(0) || on(3) || on(5) || on(7)) m |= BUTTON_X;
  if (on(1) || on(2) || on(4) || on(6)) m |= BUTTON_Z;
  return m;
}

// Direction bits for a d-pad touch at (dx, dy) from its centre, 8-way, with
// a dead zone of dead * radius.
export function dirBits(dx, dy, r, dead = 0.22) {
  const d = Math.hypot(dx, dy);
  if (d < r * dead) return 0;
  const a = Math.atan2(dy, dx), s = Math.PI / 8;
  let m = 0;
  if (Math.abs(a) < 3 * s) m |= BUTTON_RIGHT;
  if (Math.abs(a) > 5 * s) m |= BUTTON_LEFT;
  if (a > s && a < 7 * s) m |= BUTTON_DOWN;
  if (a < -s && a > -7 * s) m |= BUTTON_UP;
  return m;
}

export class Input {
  constructor() {
    this.keys = [0, 0, 0, 0]; this.pads = [0, 0, 0, 0]; this.touch = 0; this.touchPtr = new Map();
    this.mouse = { x: 0x7fff, y: 0x7fff, b: 0 };
    this.armed = false; this.padNames = [];
    this.onActivity = null;
  }

  gamepad(i) { return (this.keys[i] | this.pads[i] | (i === 0 ? this.touch : 0)) & 0xff; }

  bindKeys(target = window) {
    const h = e => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA')) return;
      const down = e.type === 'keydown';
      if (down && e.code === 'Escape') { this.armed = false; return; }
      const k = KEYS[e.code];
      if (!k) return;
      if (!this.armed) { if (!down) this.keys[k[0]] &= ~k[1]; return; }
      e.preventDefault();
      if (down) this.keys[k[0]] |= k[1]; else this.keys[k[0]] &= ~k[1];
      if (this.onActivity) this.onActivity(e);
    };
    target.addEventListener('keydown', h); target.addEventListener('keyup', h);
    window.addEventListener('blur', () => { this.keys.fill(0); });
  }

  pollPads() {
    this.pads.fill(0);
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let list; try { list = navigator.getGamepads(); } catch (e) { return; }
    const names = [];
    for (const gp of list || []) {
      if (!gp || gp.mapping !== 'standard') continue;
      const m = padBits(gp.buttons, gp.axes);
      this.pads[gp.index % 4] |= m;
      names.push(gp.id);
      if (m && this.onActivity) this.onActivity(null);
    }
    this.padNames = names;
  }

  // The on-screen pad: el.dpad (the d-pad disc) and buttons with data-btn
  // = "x" or "z". Every pointer keeps its own bits.
  bindPad(dpad, buttons) {
    const recompute = () => { let m = 0; for (const v of this.touchPtr.values()) m |= v; this.touch = m; };
    const dpadMove = e => {
      const r = dpad.getBoundingClientRect();
      this.touchPtr.set(e.pointerId, dirBits(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, r.width / 2));
      recompute();
    };
    const end = e => { this.touchPtr.delete(e.pointerId); recompute(); };
    dpad.addEventListener('pointerdown', e => { e.preventDefault(); this.armed = true; try { dpad.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } dpadMove(e); if (this.onActivity) this.onActivity(e); });
    dpad.addEventListener('pointermove', e => { if (this.touchPtr.has(e.pointerId)) dpadMove(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) dpad.addEventListener(ev, end);
    for (const b of buttons) {
      const bit = b.dataset.btn === 'x' ? BUTTON_X : BUTTON_Z;
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.armed = true; try { b.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } this.touchPtr.set(e.pointerId, bit); recompute(); b.classList.add('down'); if (this.onActivity) this.onActivity(e); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, e => { end(e); b.classList.remove('down'); });
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  // Mouse and touch on the glass. glass() returns the glass rect in CSS px
  // relative to el.
  bindScreen(el, glass) {
    const map = e => {
      const r = el.getBoundingClientRect(), g = glass();
      const x = Math.floor((e.clientX - r.left - g.x) / g.w * 160), y = Math.floor((e.clientY - r.top - g.y) / g.h * 160);
      this.mouse.x = Math.max(-1, Math.min(160, x)); this.mouse.y = Math.max(-1, Math.min(160, y));
    };
    const bits = e => (e.buttons & 1 ? 1 : 0) | (e.buttons & 2 ? 2 : 0) | (e.buttons & 4 ? 4 : 0);
    el.addEventListener('pointerdown', e => { this.armed = true; map(e); this.mouse.b = e.pointerType === 'mouse' ? bits(e) : 1; try { el.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } if (this.onActivity) this.onActivity(e); });
    el.addEventListener('pointermove', e => { map(e); if (e.pointerType === 'mouse') this.mouse.b = bits(e); });
    el.addEventListener('pointerup', e => { map(e); this.mouse.b = e.pointerType === 'mouse' ? bits(e) : 0; });
    el.addEventListener('pointercancel', () => { this.mouse.b = 0; });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !e.buttons) { this.mouse.x = 0x7fff; this.mouse.y = 0x7fff; } });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  clear() { this.keys.fill(0); this.touch = 0; this.touchPtr.clear(); this.mouse.b = 0; }
}
