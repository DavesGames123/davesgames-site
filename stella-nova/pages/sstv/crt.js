// ============================================================================
//  SSTV  ·  the CRT monitor  (ES module, 2D canvas only)
// ----------------------------------------------------------------------------
//  A skeuomorphic slow-scan monitor drawn with the 2D canvas API, so it runs
//  the same in Safari, Chrome, Firefox and node (@napi-rs/canvas). The page
//  makes no WebGL or WebGPU context, so no fallback path is needed.
//
//  LAYERS, back to front, for one frame (render):
//    1. picture P     the received picture, W x H of the mode, mapped
//                     through the phosphor (colour or one tint)
//    2. flash F       the same rows in the beam-flash colour
//    3. screen S      device pixels of the glass: unlit phosphor, P scaled
//                     in, the last rows again from F (persistence, alpha
//                     exp(-age / tau)), the beam spot and its line,
//                     scanlines aligned to the mode's lines, a shadow-mask
//                     stripe (colour only), bloom (S down 8x, added back),
//                     snow when there is no signal, flicker, a hum bar
//    4. warp          S into O with barrel distortion: rows, then columns,
//                     each strip scaled by 1 - k v^2
//    5. glass         rounded corners, vignette, reflections, inner shadow
//    6. cabinet       bezel, body, badge, knobs, LED and a readout window
//
//  grep -n targets
//    "export const PHOSPHORS"   tint, flash colour, persistence tau
//    "export class CRT"
//    "  paintRows("             decoded rows into P and F
//    "  render("                one frame
//    "  layout("                cabinet and screen rectangles
// ============================================================================
import { mkCanvas, roundRect } from './view.js';

export const PHOSPHORS = {
  colour: { name: 'Colour', tint: null, flash: [255, 250, 240], tau: 0.12, mask: true, bg: [10, 11, 12] },
  p7: { name: 'P7', long: 'P7 blue-white, yellow-green afterglow (classic SSTV)', tint: [178, 236, 96], flash: [190, 214, 255], tau: 1.6, bg: [9, 12, 8] },
  p31: { name: 'P31', long: 'P31 green', tint: [72, 255, 128], flash: [190, 255, 210], tau: 0.25, bg: [5, 12, 7] },
  p4: { name: 'P4', long: 'P4 white (television)', tint: [226, 234, 255], flash: [255, 255, 255], tau: 0.08, bg: [10, 10, 12] },
  amber: { name: 'Amber', long: 'Amber (P3)', tint: [255, 172, 44], flash: [255, 226, 160], tau: 0.6, bg: [12, 8, 4] },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class CRT {
  constructor() {
    this.ph = 'colour'; this.W = 0; this.H = 0; this.raw = null; this.ages = []; this.S = null; this.sw = 0; this.sh = 0;
    this.noise = null; this.seed = 1;
  }
  setPicture(W, H, aspect = W / H) {
    this.W = W; this.H = H; this.aspect = aspect;
    this.P = mkCanvas(W, H); this.pg = this.P.getContext('2d');
    this.F = mkCanvas(W, H); this.fg = this.F.getContext('2d');
    this.raw = new Uint8ClampedArray(W * H * 4);
    this.pd = this.pg.createImageData(W, H); this.fd = this.fg.createImageData(W, H);
    this.got = new Uint8Array(H);
    this.ages = [];
    this.pg.clearRect(0, 0, W, H); this.fg.clearRect(0, 0, W, H);
    this.scanPat = null;
  }
  setPhosphor(id) {
    if (!PHOSPHORS[id] || id === this.ph) return;
    this.ph = id;
    if (this.raw) { const rows = []; for (let r = 0; r < this.H; r++) if (this.got[r]) rows.push(r); this.map(rows); }
  }
  // Copy rows of a decoded RGBA picture (same W x H) and mark them fresh.
  paintRows(img, rows, now = 0) {
    for (const r of rows) {
      if (r < 0 || r >= this.H) continue;
      this.raw.set(img.subarray(r * this.W * 4, (r + 1) * this.W * 4), r * this.W * 4);
      this.got[r] = 1;
      this.ages.push({ r, t: now });
    }
    this.map(rows);
    if (this.ages.length > 400) this.ages.splice(0, this.ages.length - 400);
  }
  // Fill the whole picture at once (finish pass, saver jumps, thumbnails).
  paintAll(img) { const rows = []; for (let r = 0; r < this.H; r++) rows.push(r); this.raw.set(img); this.got.fill(1); this.map(rows); }
  clearPicture() { if (!this.raw) return; this.raw.fill(0); this.got.fill(0); this.ages = []; this.pg.clearRect(0, 0, this.W, this.H); this.fg.clearRect(0, 0, this.W, this.H); }
  map(rows) {
    const P = PHOSPHORS[this.ph], W = this.W, raw = this.raw, pd = this.pd.data, fd = this.fd.data;
    let lo = this.H, hi = -1;
    for (const r of rows) {
      if (r < 0 || r >= this.H) continue;
      lo = Math.min(lo, r); hi = Math.max(hi, r);
      for (let x = 0; x < W; x++) {
        const o = (r * W + x) * 4, R = raw[o], G = raw[o + 1], B = raw[o + 2];
        const l = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
        if (P.tint) { const k = Math.pow(l, 1.1); pd[o] = P.tint[0] * k; pd[o + 1] = P.tint[1] * k; pd[o + 2] = P.tint[2] * k; }
        else { pd[o] = R; pd[o + 1] = G; pd[o + 2] = B; }
        pd[o + 3] = this.got[r] ? 255 : 0;
        const f = Math.pow(l, 0.8);
        fd[o] = P.flash[0] * f; fd[o + 1] = P.flash[1] * f; fd[o + 2] = P.flash[2] * f; fd[o + 3] = 255;
      }
    }
    // A small ImageData per range (a dirty-rect putImageData crashes
    // @napi-rs/canvas, and a small copy is cheap in browsers too).
    if (hi >= lo) {
      const n = hi - lo + 1, a = lo * W * 4, b = (hi + 1) * W * 4;
      const p1 = this.pg.createImageData(W, n); p1.data.set(pd.subarray(a, b)); this.pg.putImageData(p1, 0, lo);
      const f1 = this.fg.createImageData(W, n); f1.data.set(fd.subarray(a, b)); this.fg.putImageData(f1, 0, lo);
    }
  }
  // Cabinet and screen rectangles inside box {x, y, w, h} (CSS px).
  layout(box, bare = false) {
    if (bare) {
      const pad = Math.min(box.w, box.h) * 0.035;
      return { cab: null, bezel: { x: box.x, y: box.y, w: box.w, h: box.h }, scr: { x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: box.h - 2 * pad }, panel: null };
    }
    const ar = 1.18, panelH = Math.min(box.h * 0.16, 64);
    let cw = box.w, ch = box.w / ar + panelH;
    if (ch > box.h) { ch = box.h; cw = (box.h - panelH) * ar; }
    const cx = box.x + (box.w - cw) / 2, cy = box.y + (box.h - ch) / 2;
    const m = cw * 0.045;
    const bezel = { x: cx + m, y: cy + m, w: cw - 2 * m, h: ch - panelH - m * 1.3 };
    const bm = Math.min(bezel.w, bezel.h) * 0.055;
    const scr = { x: bezel.x + bm, y: bezel.y + bm, w: bezel.w - 2 * bm, h: bezel.h - 2 * bm };
    const panel = { x: cx + m, y: bezel.y + bezel.h + m * 0.35, w: cw - 2 * m, h: cy + ch - (bezel.y + bezel.h + m * 0.35) - m * 0.5 };
    return { cab: { x: cx, y: cy, w: cw, h: ch }, bezel, scr, panel };
  }
  // One frame. o: { box, dpr, t (s), on, beam: { row (float), x (0..1),
  // col: [r,g,b] } | null, snow (0..1), bare, readout: [line1, line2],
  // led (bool), curve (1), bloom (1), flicker (1) }
  render(g, o) {
    const dpr = o.dpr || 1, L = this.layout(o.box, o.bare), P = PHOSPHORS[this.ph];
    this.L = L;
    if (L.cab) this.cabinet(g, L, o);
    this.bezel(g, L, o);
    const sw = Math.max(16, Math.round(L.scr.w * dpr)), sh = Math.max(16, Math.round(L.scr.h * dpr));
    if (!this.S || this.sw !== sw || this.sh !== sh) {
      this.sw = sw; this.sh = sh;
      this.S = mkCanvas(sw, sh); this.T = mkCanvas(sw, sh); this.O = mkCanvas(sw, sh);
      this.B = mkCanvas(Math.max(4, sw >> 3), Math.max(4, sh >> 3));
      this.scanPat = null;
    }
    const s = this.S.getContext('2d');
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
    const on = o.on !== false;
    s.fillStyle = `rgb(${P.bg[0] * (on ? 1.6 : 1)},${P.bg[1] * (on ? 1.6 : 1)},${P.bg[2] * (on ? 1.6 : 1)})`;
    s.fillRect(0, 0, sw, sh);
    // picture rect inside the glass: contain, small overscan
    let pr = null;
    if (on && this.W) {
      const a = this.aspect, ov = 1.03;
      let pw = sw * ov, ph = pw / a;
      if (ph > sh * ov) { ph = sh * ov; pw = ph * a; }
      pr = { x: (sw - pw) / 2, y: (sh - ph) / 2, w: pw, h: ph };
      s.imageSmoothingEnabled = true;
      s.drawImage(this.P, pr.x, pr.y, pr.w, pr.h);
      // persistence: fresh rows again in the flash colour
      const now = o.t || 0, tau = P.tau * (o.tauScale || 1);
      s.globalCompositeOperation = 'lighter';
      const keep = [];
      for (const A of this.ages) {
        const age = Math.max(0, now - A.t), k = Math.exp(-age / tau);
        if (k < 0.02) continue;
        keep.push(A);
        s.globalAlpha = 0.85 * k;
        const y0 = pr.y + A.r * pr.h / this.H, rh = Math.max(1, pr.h / this.H);
        s.drawImage(this.F, 0, A.r, this.W, 1, pr.x, y0, pr.w, rh + 0.5);
      }
      this.ages = keep;
      // beam
      const b = o.beam;
      if (b && b.row != null && b.row >= 0 && b.row < this.H) {
        const rh = pr.h / this.H, by = pr.y + (b.row + 0.5) * rh, bx = pr.x + clamp(b.x, 0, 1) * pr.w;
        const c = b.col || P.flash, rgb = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
        s.globalAlpha = 0.35;
        const lg = s.createLinearGradient(pr.x, 0, bx, 0);
        lg.addColorStop(0, `rgba(${rgb},0)`); lg.addColorStop(1, `rgba(${rgb},0.9)`);
        s.fillStyle = lg; s.fillRect(pr.x, by - rh * 0.6, Math.max(0, bx - pr.x), rh * 1.2);
        s.globalAlpha = 1;
        const R = Math.max(3, rh * 3.2);
        const rg = s.createRadialGradient(bx, by, 0, bx, by, R);
        rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, `rgba(${rgb},0.85)`); rg.addColorStop(1, `rgba(${rgb},0)`);
        s.fillStyle = rg; s.fillRect(bx - R, by - R, 2 * R, 2 * R);
      }
      s.globalAlpha = 1; s.globalCompositeOperation = 'source-over';
    }
    // snow
    if (on && o.snow > 0) {
      if (!this.noise) {
        this.noise = mkCanvas(160, 120); const ng = this.noise.getContext('2d'), d = ng.createImageData(160, 120);
        for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
        ng.putImageData(d, 0, 0);
      }
      s.globalCompositeOperation = 'lighter'; s.globalAlpha = 0.18 * o.snow;
      const ox = Math.random() * 80, oy = Math.random() * 60;
      s.imageSmoothingEnabled = false;
      s.drawImage(this.noise, ox, oy, 80, 60, 0, 0, sw, sh);
      s.imageSmoothingEnabled = true;
      s.globalAlpha = 1; s.globalCompositeOperation = 'source-over';
    }
    // scanlines aligned to the picture lines, and the shadow mask
    if (on && pr) {
      const rh = pr.h / this.H;
      if (!this.scanPat || this.scanKey !== `${sw}x${sh}:${this.H}:${this.ph}`) {
        this.scanKey = `${sw}x${sh}:${this.H}:${this.ph}`;
        const pat = mkCanvas(sw, sh), pg = pat.getContext('2d');
        pg.fillStyle = '#fff'; pg.fillRect(0, 0, sw, sh);
        const gapA = rh >= 3 ? 0.55 : rh >= 2 ? 0.4 : 0.22;
        pg.fillStyle = `rgba(0,0,0,${gapA})`;
        for (let r = 0; r <= this.H; r++) { const y = pr.y + r * rh; pg.fillRect(0, y - Math.max(0.6, rh * 0.28), sw, Math.max(0.6, rh * 0.28)); }
        if (P.mask) {
          const cols = ['rgba(255,90,90,0.22)', 'rgba(90,255,90,0.22)', 'rgba(90,90,255,0.22)'];
          const step = Math.max(1, Math.round(sw / 900));
          for (let x = 0, i = 0; x < sw; x += step, i++) { pg.fillStyle = cols[i % 3]; pg.fillRect(x, 0, step, sh); }
        }
        this.scanPat = pat;
      }
      s.globalCompositeOperation = 'multiply'; s.drawImage(this.scanPat, 0, 0);
      s.globalCompositeOperation = 'source-over';
    }
    // bloom
    if (on) {
      const bg = this.B.getContext('2d');
      bg.globalCompositeOperation = 'copy'; bg.imageSmoothingEnabled = true;
      bg.drawImage(this.S, 0, 0, this.B.width, this.B.height);
      bg.globalCompositeOperation = 'source-over';
      s.globalCompositeOperation = 'lighter'; s.globalAlpha = 0.42 * (o.bloom == null ? 1 : o.bloom);
      s.drawImage(this.B, 0, 0, sw, sh);
      s.globalAlpha = 0.18 * (o.bloom == null ? 1 : o.bloom);
      s.drawImage(this.B, -sw * 0.02, -sh * 0.02, sw * 1.04, sh * 1.04);
      s.globalAlpha = 1; s.globalCompositeOperation = 'source-over';
      // hum bar and flicker
      const t = o.t || 0, fl = o.flicker == null ? 1 : o.flicker;
      const hy = ((t * 0.09) % 1.3 - 0.15) * sh;
      const hg = s.createLinearGradient(0, hy - sh * 0.12, 0, hy + sh * 0.12);
      hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, `rgba(255,255,255,${0.025 * fl})`); hg.addColorStop(1, 'rgba(255,255,255,0)');
      s.globalCompositeOperation = 'lighter'; s.fillStyle = hg; s.fillRect(0, hy - sh * 0.12, sw, sh * 0.24);
      s.globalCompositeOperation = 'source-over';
      const f = 0.035 * fl * (0.5 + 0.5 * Math.sin(t * 47.0) * Math.sin(t * 13.3));
      if (f > 0) { s.fillStyle = `rgba(0,0,0,${f})`; s.fillRect(0, 0, sw, sh); }
    }
    // warp
    const k = 0.075 * (o.curve == null ? 1 : o.curve);
    const tg = this.T.getContext('2d'), og = this.O.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0); og.setTransform(1, 0, 0, 1, 0, 0);
    tg.fillStyle = '#000'; tg.fillRect(0, 0, sw, sh); og.fillStyle = '#000'; og.fillRect(0, 0, sw, sh);
    const st = Math.max(2, Math.round(sh / 260));
    for (let y = 0; y < sh; y += st) {
      const v = (y + st / 2 - sh / 2) / (sh / 2), sc = 1 - k * v * v, dw = sw * sc;
      tg.drawImage(this.S, 0, y, sw, st, (sw - dw) / 2, y, dw, st + 0.6);
    }
    const sx = Math.max(2, Math.round(sw / 320));
    for (let x = 0; x < sw; x += sx) {
      const u = (x + sx / 2 - sw / 2) / (sw / 2), sc = 1 - k * 0.9 * u * u, dh = sh * sc;
      og.drawImage(this.T, x, 0, sx, sh, x, (sh - dh) / 2, sx + 0.6, dh);
    }
    // onto the page, clipped to the glass
    const S = L.scr, rad = Math.min(S.w, S.h) * 0.07;
    g.save();
    roundRect(g, S.x, S.y, S.w, S.h, rad); g.clip();
    g.drawImage(this.O, S.x, S.y, S.w, S.h);
    // vignette
    const cx = S.x + S.w / 2, cy = S.y + S.h / 2, Rv = Math.hypot(S.w, S.h) / 2;
    const vg = g.createRadialGradient(cx, cy, Rv * 0.45, cx, cy, Rv);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.75, 'rgba(0,0,0,0.28)'); vg.addColorStop(1, 'rgba(0,0,0,0.78)');
    g.fillStyle = vg; g.fillRect(S.x, S.y, S.w, S.h);
    // glass reflections
    const rg = g.createLinearGradient(S.x, S.y, S.x + S.w * 0.6, S.y + S.h * 0.7);
    rg.addColorStop(0, 'rgba(255,255,255,0.10)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.025)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(S.x, S.y, S.w, S.h);
    g.save();
    g.translate(S.x + S.w * 0.3, S.y + S.h * 0.16); g.scale(1, 0.32);
    const hg = g.createRadialGradient(0, 0, 0, 0, 0, S.w * 0.32);
    hg.addColorStop(0, 'rgba(255,255,255,0.07)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg; g.fillRect(-S.w * 0.32, -S.w * 0.32, S.w * 0.64, S.w * 0.64);
    g.restore();
    // inner shadow at the glass edge
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(0,0,0,${0.32 - i * 0.05})`; g.lineWidth = 2 + i * 2.2;
      roundRect(g, S.x, S.y, S.w, S.h, rad); g.stroke();
    }
    g.restore();
  }
  bezel(g, L, o) {
    const B = L.bezel, S = L.scr, r = Math.min(B.w, B.h) * 0.09;
    g.save();
    const bg = g.createLinearGradient(B.x, B.y, B.x, B.y + B.h);
    bg.addColorStop(0, '#2c2a27'); bg.addColorStop(0.5, '#1b1a18'); bg.addColorStop(1, '#0f0e0d');
    roundRect(g, B.x, B.y, B.w, B.h, r); g.fillStyle = bg; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; roundRect(g, B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1, r); g.stroke();
    // a dark recess around the glass
    const rr = Math.min(S.w, S.h) * 0.07 + 4;
    roundRect(g, S.x - 4, S.y - 4, S.w + 8, S.h + 8, rr); g.fillStyle = '#050505'; g.fill();
    const lg = g.createLinearGradient(0, S.y - 6, 0, S.y + S.h + 6);
    lg.addColorStop(0, 'rgba(0,0,0,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0.10)');
    g.strokeStyle = lg; g.lineWidth = 2; roundRect(g, S.x - 5, S.y - 5, S.w + 10, S.h + 10, rr + 1); g.stroke();
    g.restore();
  }
  cabinet(g, L, o) {
    const C = L.cab, r = Math.min(C.w, C.h) * 0.06;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 30; g.shadowOffsetY = 12;
    const cg = g.createLinearGradient(C.x, C.y, C.x, C.y + C.h);
    cg.addColorStop(0, '#3b3832'); cg.addColorStop(0.06, '#2b2925'); cg.addColorStop(0.7, '#1d1c19'); cg.addColorStop(1, '#121110');
    roundRect(g, C.x, C.y, C.w, C.h, r); g.fillStyle = cg; g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1.2; roundRect(g, C.x + 1, C.y + 1, C.w - 2, C.h - 2, r); g.stroke();
    // panel
    const P = L.panel;
    if (P && P.h > 18) {
      const pg = g.createLinearGradient(0, P.y, 0, P.y + P.h);
      pg.addColorStop(0, '#191816'); pg.addColorStop(1, '#24221f');
      roundRect(g, P.x, P.y, P.w, P.h, Math.min(10, P.h * 0.25)); g.fillStyle = pg; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();
      const cy = P.y + P.h / 2;
      const rw0 = Math.min(P.w * 0.34, 230), rx0 = P.x + P.w * 0.5 - rw0 / 2 + P.w * 0.06;
      const room0 = (P.w > 360 ? rx0 : P.x + P.w - P.h * 2.5) - (P.x + P.h * 0.45) - 10;
      let fs = clamp(P.h * 0.24, 9, 15);
      g.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      const bw = g.measureText('SLOW-SCAN MONITOR').width;
      if (bw > room0) fs = Math.max(7, fs * room0 / bw);
      g.font = `600 ${fs}px Inter, system-ui, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText('SLOW-SCAN MONITOR', P.x + P.h * 0.45 + 1, cy - fs * 0.35 + 1);
      g.fillStyle = '#b8b0a0'; g.fillText('SLOW-SCAN MONITOR', P.x + P.h * 0.45, cy - fs * 0.35);
      g.font = `400 ${fs * 0.72}px Inter, system-ui, sans-serif`; g.fillStyle = '#80786c';
      // readout window
      const rw = Math.min(P.w * 0.34, 230), rh = P.h * 0.62, rx = P.x + P.w * 0.5 - rw / 2 + P.w * 0.06, ry = cy - rh / 2;
      let sub = PHOSPHORS[this.ph].long || 'Colour shadow-mask tube';
      const room = (P.w > 360 ? rx : P.x + P.w - P.h * 2.5) - (P.x + P.h * 0.45) - 10;
      while (sub.length > 4 && g.measureText(sub).width > room) sub = sub.slice(0, -2);
      if (sub !== (PHOSPHORS[this.ph].long || 'Colour shadow-mask tube')) sub = sub.trimEnd() + '…';
      g.fillText(sub, P.x + P.h * 0.45, cy + fs * 0.62);
      if (P.w > 360) {
        roundRect(g, rx, ry, rw, rh, 4); g.fillStyle = '#060a07'; g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.stroke();
        const lines = o.readout || ['', ''];
        g.font = `500 ${clamp(rh * 0.3, 8, 13)}px ui-monospace, Menlo, monospace`; g.fillStyle = '#7fe0a8';
        g.shadowColor = 'rgba(127,224,168,0.6)'; g.shadowBlur = 6;
        g.fillText(lines[0] || '', rx + 8, ry + rh * 0.32);
        g.fillStyle = '#5fb888'; g.fillText(lines[1] || '', rx + 8, ry + rh * 0.72);
        g.shadowBlur = 0;
      }
      // knobs and LED
      const kr = P.h * 0.3;
      for (let i = 0; i < 2; i++) {
        const kx = P.x + P.w - P.h * (0.6 + i * 0.95), ky = cy;
        const kg = g.createRadialGradient(kx - kr * 0.3, ky - kr * 0.4, kr * 0.1, kx, ky, kr);
        kg.addColorStop(0, '#5a5650'); kg.addColorStop(1, '#151412');
        g.beginPath(); g.arc(kx, ky, kr, 0, Math.PI * 2); g.fillStyle = kg; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.5; g.stroke();
        const a = -2.2 + i * 1.7 + (o.knob || 0) * (i ? 0.3 : 0.6);
        g.strokeStyle = '#d8d0c0'; g.lineWidth = 2; g.beginPath(); g.moveTo(kx + Math.cos(a) * kr * 0.35, ky + Math.sin(a) * kr * 0.35); g.lineTo(kx + Math.cos(a) * kr * 0.85, ky + Math.sin(a) * kr * 0.85); g.stroke();
      }
      const lx = P.x + P.w - P.h * 2.25, lr = Math.max(2.5, P.h * 0.06);
      if (P.w > 300) {
        g.beginPath(); g.arc(lx, cy, lr, 0, Math.PI * 2);
        g.fillStyle = o.led ? '#ff4a3a' : '#3a1210'; g.shadowColor = o.led ? 'rgba(255,74,58,0.9)' : 'transparent'; g.shadowBlur = o.led ? 10 : 0; g.fill(); g.shadowBlur = 0;
      }
    }
    g.restore();
  }
  // Where a picture point lands on the page (CSS px), for close-ups.
  // L: a layout() result (default: the last render).
  pointOnPage(row, xf, L = this.L) {
    const S = L ? L.scr : null;
    if (!S || !this.W) return null;
    const a = this.aspect, ov = 1.03;
    let pw = S.w * ov, ph = pw / a;
    if (ph > S.h * ov) { ph = S.h * ov; pw = ph * a; }
    return { x: S.x + (S.w - pw) / 2 + xf * pw, y: S.y + (S.h - ph) / 2 + (row + 0.5) / this.H * ph };
  }
}
