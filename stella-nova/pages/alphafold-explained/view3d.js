// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  small 3D view on a 2D canvas  (no WebGL)
// ----------------------------------------------------------------------------
//  Draws depth-sorted segments and dots with a perspective camera. No GPU
//  context is made, so the page holds nothing for the shell to release.
//  The scene is a callback: build(add) pushes primitives each frame.
//
//    add.seg(a, b, rgb, width, id)   a tube piece from a to b (Å)
//    add.dot(p, rgb, radius, id)     a shaded ball
//    add.line(a, b, rgb, width)      a thin line on top (frame axes)
//
//  INPUT. A horizontal drag turns the model about the vertical axis. The
//  canvas has touch-action: pan-y, so a vertical swipe still scrolls the
//  page on a phone. A tap (no drag) calls onPick with the nearest id.
//
//  grep: class View3D  function project  function draw  onPick
// ============================================================================
const BG = [10, 12, 19];

export class View3D {
  constructor(canvas, opt = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.yaw = opt.yaw ?? 0.6; this.pitch = opt.pitch ?? -0.25;
    this.radius = opt.radius ?? 26; this.spin = opt.spin ?? 0.12;
    this.build = opt.build || (() => {});
    this.onPick = opt.onPick || null;
    this.dirty = true; this.prims = []; this.held = false; this.idle = 0;
    this.fog = opt.fog ?? 0.55;
    this.resize();
    const ro = new ResizeObserver(() => { this.resize(); this.dirty = true; });
    ro.observe(canvas);
    let sx = 0, sy = 0, moved = false, id = null, lastX = 0;
    canvas.addEventListener('pointerdown', e => {
      id = e.pointerId; sx = lastX = e.clientX; sy = e.clientY; moved = false; this.held = true;
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) {
        moved = true; try { canvas.setPointerCapture(id); } catch (_) {}
      }
      if (moved) {
        this.yaw += (e.clientX - lastX) * 0.012;
        if (e.pointerType === 'mouse') this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + e.movementY * 0.01));
        lastX = e.clientX; this.dirty = true; this.idle = 0;
      }
    });
    const end = e => {
      if (e.pointerId !== id) return;
      if (!moved && e.type === 'pointerup' && this.onPick) this.pick(e);
      id = null; this.held = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.dpr = dpr;
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
  }
  // World (Å) to screen. Returns [x, y, depth, scale].
  project(p) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = cy * p[0] + sy * p[2], z1 = -sy * p[0] + cy * p[2];
    const y2 = cp * p[1] - sp * z1, z2 = sp * p[1] + cp * z1;
    const D = this.radius * 4.2, f = D / (D - z2);
    const s = Math.min(this.w, this.h) / (2.25 * this.radius);
    return [this.w / 2 + x1 * s * f, this.h / 2 - y2 * s * f, z2, s * f];
  }
  pick(e) {
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 24 * 24;
    for (const q of this.prims) if (q.id != null) {
      const d = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (d < bd) { bd = d; best = q.id; }
    }
    this.onPick(best);
  }
  tick(dt) {
    if (this.spin && !this.held) { this.idle += dt; if (this.idle > 1.2) { this.yaw += this.spin * dt; this.dirty = true; } }
    if (this.dirty) { this.draw(); this.dirty = false; }
  }
  draw() {
    const P = [], self = this;
    const add = {
      seg(a, b, c, w = 1.6, id = null) {
        const pa = self.project(a), pb = self.project(b);
        P.push({ k: 0, x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2, z: (pa[2] + pb[2]) / 2, pa, pb, c, w, id });
      },
      dot(p, c, r = 1, id = null) { const q = self.project(p); P.push({ k: 1, x: q[0], y: q[1], z: q[2], s: q[3], c, r, id }); },
      line(a, b, c, w = 1) {
        const pa = self.project(a), pb = self.project(b);
        P.push({ k: 2, x: 0, y: 0, z: Math.max(pa[2], pb[2]) + 0.01, pa, pb, c, w });
      },
    };
    this.build(add);
    P.sort((a, b) => a.z - b.z);
    this.prims = P;
    const g = this.ctx, R = this.radius;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round';
    const shade = (c, z, k = 1) => {
      const f = Math.max(0, Math.min(1, 0.5 - z / (2.4 * R))) * this.fog;
      return `rgb(${Math.round((c[0] * (1 - f) + BG[0] * f) * k)},${Math.round((c[1] * (1 - f) + BG[1] * f) * k)},${Math.round((c[2] * (1 - f) + BG[2] * f) * k)})`;
    };
    for (const q of P) {
      if (q.k === 0) {
        const s = (q.pa[3] + q.pb[3]) / 2;
        g.strokeStyle = shade(q.c, q.z, 0.45); g.lineWidth = q.w * s + 1.4;
        g.beginPath(); g.moveTo(q.pa[0], q.pa[1]); g.lineTo(q.pb[0], q.pb[1]); g.stroke();
        g.strokeStyle = shade(q.c, q.z); g.lineWidth = q.w * s;
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = q.w * s * 0.28;
        g.beginPath(); g.moveTo(q.pa[0] - q.w * s * 0.18, q.pa[1] - q.w * s * 0.18); g.lineTo(q.pb[0] - q.w * s * 0.18, q.pb[1] - q.w * s * 0.18); g.stroke();
      } else if (q.k === 1) {
        const r = Math.max(0.6, q.r * q.s);
        g.fillStyle = shade(q.c, q.z);
        g.beginPath(); g.arc(q.x, q.y, r, 0, 6.2832); g.fill();
        if (r > 2.2) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(q.x - r * 0.3, q.y - r * 0.3, r * 0.38, 0, 6.2832); g.fill(); }
      } else {
        g.strokeStyle = typeof q.c === 'string' ? q.c : shade(q.c, q.z); g.lineWidth = q.w;
        g.beginPath(); g.moveTo(q.pa[0], q.pa[1]); g.lineTo(q.pb[0], q.pb[1]); g.stroke();
      }
    }
  }
}
