// ============================================================================
//  THIN-FILM CLOTH  ·  sim-core.js — the message handler around xpbd.js
// ----------------------------------------------------------------------------
//  One protocol for the worker and for the page-thread fallback.
//
//  In:
//    { op: 'init', cfg }      cfg = { nx, ny, size, center, plane, fabric,
//                             gravity, colliders, selfContact, substeps,
//                             pins: [particle ids], tilt }
//    { op: 'step', dt, wind: {speed, dir, turb}, gravity, tearing,
//      events: [...] }        events: ['grab', x, y, z] ['move', x, y, z]
//                             ['drop'] ['pin', x, y, z] ['cut', x, y, z]
//                             ['clearPins'] ['fabric', key] ['colliders', list]
//    { op: 'lut', key, film, opts }   build a film table (film.js)
//  Out:
//    { op: 'frame', x, nrm, tan, ratio, tris?, pins?, ms, err }
//    { op: 'lut', key, lut }
//
//  grep -n 'case' for the ops.
// ============================================================================
import { Cloth, FABRICS } from './xpbd.js';
import { buildLUT } from './film.js';

export class SimCore {
  constructor() { this.cloth = null; this.pinsDirty = true; }
  handle(m) {
    switch (m.op) {
      case 'init': {
        const c = m.cfg;
        this.cloth = new Cloth({ ...c, fabric: FABRICS[c.fabric] || FABRICS.silk });
        if (c.tilt) this.cloth.reset({ tilt: c.tilt });
        this.cloth.colliders = c.colliders || [];
        for (const k of c.pins || []) this.cloth.setPin(k, true);
        this.pinsDirty = true; this.cloth.torn = true;
        return this.frame(0);
      }
      case 'step': {
        const c = this.cloth; if (!c) return null;
        for (const ev of m.events || []) this.event(ev);
        c.wind.speed = m.wind.speed; c.wind.dir = m.wind.dir; c.wind.turb = m.wind.turb;
        c.gravity = m.gravity; c.tearing = !!m.tearing;
        const t0 = performance.now();
        if (m.dt > 0) c.step(m.dt);
        return this.frame(performance.now() - t0);
      }
      case 'lut': {
        const L = buildLUT(m.film, m.opts);
        return { msg: { op: 'lut', key: m.key, lut: L }, transfer: [L.data.buffer] };
      }
    }
    return null;
  }
  event(ev) {
    const c = this.cloth;
    switch (ev[0]) {
      case 'grab': c.grabStart(ev[1], ev[2], ev[3], ev[4] || 0.05); break;
      case 'move': c.grabMove(ev[1], ev[2], ev[3]); break;
      case 'drop': c.grabEnd(); break;
      case 'pin': {
        const k = c.nearest(ev[1], ev[2], ev[3]);
        if (k >= 0) c.setPin(k, !c.pin[k]);
        this.pinsDirty = true; break;
      }
      case 'cut': c.cut(ev[1], ev[2], ev[3]); break;
      case 'clearPins': c.clearPins(); this.pinsDirty = true; break;
      case 'fabric': c.setFabric(FABRICS[ev[1]] || c.fabric); break;
      case 'colliders': c.colliders = ev[1]; break;
    }
  }
  frame(ms) {
    const c = this.cloth, s = c.surface();
    const msg = { op: 'frame', x: c.x.slice(), nrm: s.nrm.slice(), tan: s.tan.slice(), ratio: s.ratio.slice(), ms, err: c.error(0) };
    const transfer = [msg.x.buffer, msg.nrm.buffer, msg.tan.buffer, msg.ratio.buffer];
    if (c.torn) { msg.tris = c.triangles(); transfer.push(msg.tris.buffer); }
    if (this.pinsDirty) {
      const p = []; for (let k = 0; k < c.n; k++) if (c.pin[k]) p.push(k);
      msg.pins = Int32Array.from(p); transfer.push(msg.pins.buffer); this.pinsDirty = false;
    }
    return { msg, transfer };
  }
}
