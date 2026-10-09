// ============================================================================
//  SIM KIT  ·  widgets/sim-kit/page2d.js — the shared frame of a 2D sim page
// ----------------------------------------------------------------------------
//  A Canvas 2D simulation page has the same plumbing every time: a canvas
//  at device pixel ratio, a clear rect beside the panel and above the
//  transport (or the saver band), a world box fitted into it with an
//  optional camera, a fixed-step loop that obeys the kit transport, and
//  pointer positions in world units. page2d() does that once.
//
//    const P = page2d({ canvas, kit, world: () => ({ w, h }), step(h) {}, draw(ctx, view, dt) {} });
//    P.view          { s, ox, oy, w, h, X(x), Y(y) }: world (y up) to device px
//    P.dpr           device pixel ratio in use (at most 2)
//    P.toWorld(e)    a pointer event to [x, y] in world units
//    P.setSaver(band, cam)   the saver band (CSS px) and camera, or null
//    P.lut(id)       a colour map LUT (768 bytes) of pages/ct-lab/colormaps,
//                    or null while the module loads
//
//  The camera is { zoom, cx, cy } in world units (cx, cy: the centre).
//  World coordinates have y up; the view flips them.
//  Helpers for drawing: background(ctx, theme, w, h, grid), lutColor(lut, t).
//
//  grep -n targets: "export function page2d", "function viewRect",
//  "export function fit", "export function background", "export function lutColor"
// ============================================================================

const MAPS_URL = new URL('../../pages/ct-lab/colormaps/maps.js', import.meta.url).href;

// Fit a world box (w x h) into a device-pixel rect, with an optional camera.
export function fit(W, Hh, rect, cam, pad = 0.04) {
  const s0 = Math.min(rect.w / (W * (1 + 2 * pad)), rect.h / (Hh * (1 + 2 * pad)));
  const z = cam && cam.zoom ? cam.zoom : 1, s = s0 * z;
  const cx = cam && cam.cx != null ? cam.cx : W / 2, cy = cam && cam.cy != null ? cam.cy : Hh / 2;
  const ox = rect.x + rect.w / 2 - cx * s, oy = rect.y + rect.h / 2 + cy * s;
  return { s, ox, oy, w: W, h: Hh, rect, X: x => ox + x * s, Y: y => oy - y * s };
}

// The theme background: a soft vertical gradient and an optional grid
// (world grid spacing gs, in world units, when a view is given).
export function background(ctx, t, w, h, view, gs = 1) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, t.bg2); g.addColorStop(1, t.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (!view || !gs) return;
  ctx.strokeStyle = t.grid; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= view.w + 1e-9; x += gs) { const X = Math.round(view.X(x)) + 0.5; ctx.moveTo(X, view.Y(0)); ctx.lineTo(X, view.Y(view.h)); }
  for (let y = 0; y <= view.h + 1e-9; y += gs) { const Y = Math.round(view.Y(y)) + 0.5; ctx.moveTo(view.X(0), Y); ctx.lineTo(view.X(view.w), Y); }
  ctx.stroke();
}

// A CSS colour from a LUT at t in [0, 1] (alpha a).
export function lutColor(lut, t, a = 1) {
  const k = Math.max(0, Math.min(255, (t * 255) | 0)) * 3;
  return a >= 1 ? `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})` : `rgba(${lut[k]},${lut[k + 1]},${lut[k + 2]},${a.toFixed(3)})`;
}

export function page2d(o) {
  const { canvas, kit } = o;
  const ctx = canvas.getContext('2d');
  const H = o.H || 1 / 60, MAXN = o.maxSteps || 4;
  let dpr = 1, cw = 1, ch = 1, saver = null, cmMod = null, last = 0, acc = 0;
  const luts = new Map();
  import(MAPS_URL).then(m => { cmMod = m; }).catch(() => {});

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    cw = Math.max(1, Math.round(innerWidth * dpr)); ch = Math.max(1, Math.round(innerHeight * dpr));
    canvas.width = cw; canvas.height = ch;
  }
  // The clear rect (device px): beside the panel, above the transport and
  // the credit bar; in the saver, the band between the plate texts.
  function viewRect() {
    if (saver) return { x: saver.band.x * dpr, y: saver.band.y * dpr, w: saver.band.w * dpr, h: saver.band.h * dpr };
    const panel = document.getElementById('sk-panel'), tr = document.querySelector('.sk-transport');
    let x1 = innerWidth, y1 = innerHeight;
    if (kit.panelOpen && panel && !kit.phone) x1 = Math.max(innerWidth * 0.45, panel.getBoundingClientRect().left);
    if (tr) y1 = Math.min(y1, tr.getBoundingClientRect().top - 6);
    if (kit.panelOpen && kit.phone && panel) y1 = Math.min(y1, panel.getBoundingClientRect().top);
    const y0 = o.top != null ? o.top : 56;
    return { x: 12 * dpr, y: y0 * dpr, w: Math.max(80, x1 - 24) * dpr, h: Math.max(80, y1 - y0 - 6) * dpr };
  }
  const P = {
    ctx, view: null,
    get dpr() { return dpr; }, get w() { return cw; }, get h() { return ch; },
    get cam() { return saver ? saver.cam : null; },
    setSaver(band, cam) { saver = band ? { band, cam } : null; },
    setCam(cam) { if (saver) saver.cam = cam; },
    lut(id) {
      if (!cmMod) return null;
      if (!luts.has(id)) { try { luts.set(id, cmMod.variant(id)); } catch (e) { luts.set(id, null); } }
      return luts.get(id);
    },
    toWorld(e) {
      const r = canvas.getBoundingClientRect(), v = P.view;
      const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      return [(px - v.ox) / v.s, (v.oy - py) / v.s];
    },
    resize,
  };
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
    if (kit.playing) {
      acc += dt * kit.speed;
      let n = 0; while (acc >= H && n < MAXN) { o.step(H); acc -= H; n++; }
      if (n === MAXN) acc = 0;
    } else if (kit.takeStep()) o.step(H);
    const wb = o.world();
    P.view = fit(wb.w, wb.h, viewRect(), saver && saver.cam, o.pad);
    o.draw(ctx, P.view, dt);
  }
  addEventListener('resize', resize); resize();
  requestAnimationFrame(frame);
  return P;
}
