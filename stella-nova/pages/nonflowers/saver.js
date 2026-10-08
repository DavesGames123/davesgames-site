// ============================================================================
//  NONFLOWERS  ·  saver.js — the screensaver tour (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. Nonflowers is by Lingdong Huang
//  (MIT); the plate credits him first.
//
//  VARIETY. opts.seed (else the clock) seeds a list of plant seeds and a
//  shuffled deck of shot types. The deck is shuffled again after each
//  pass, so the order and the plants differ from run to run. A shot takes
//  5 to 12 s (calm 1 gives the long end).
//
//  SHOTS
//    grow     one plant on its mat. A soft brush wipe grows it from the
//             root upward, then the camera pushes in on the flower head.
//    detail   one plant in a wide window: the whole plant, a cut to a
//             close look at the flower head, a cut to the stems and leaves
//             (engine.js plantFoci), each with a slow push.
//    herb     the herbarium: four or six sheets fill in one by one, each
//             with the brush wipe, then the camera goes into one sheet.
//    pair     two plants side by side (a woody and a herbal one when the
//             buffer has both) grow at the same time.
//
//  NO WAITS. The pool paints plants ahead into S.plants (up to AHEAD jobs
//  in flight, a buffer of BUF). The director takes the next deck entry
//  whose plants are ready; a shot never waits on a worker, except the
//  first one (warmupMs covers it). debug().waits counts the waits.
//
//  SCALE. The painting is a 600 px raster from upstream. Each frame draws
//  it again from the full bitmap through the camera, never from a scaled
//  copy, and the device scale stays at KMAX (2) or less.
//
//  FRAME. Every frame rect sits inside the clear band of the shell label
//  plate (plateBand, lib/saver-clear.js), so no subject goes under the
//  plate text. The saver canvas is in the document.
//
//  PROBES (CDP). snSaver.debug() gives the shot, beat, frame, zoom and
//  buffer. snSaver.cut(type) starts a shot of that type now.
//
//  grep -n targets: "function direct", "function frame", "function view",
//  "function grown", "function plate", "window.snSaver"
// ============================================================================
import { SIZE, randomSeed } from './engine.js';
import { mulberry, shuffle, codeExtract } from './view.js';

const FADE_MS = 650, XFADE_MS = 260, PAD = 40, KMAX = 2, BUF = 10, AHEAD = 2;
const DECK = ['grow', 'detail', 'herb', 'pair', 'grow', 'detail', 'grow'];
const NEED = { grow: 1, detail: 1, herb: 4, pair: 2 };
const ease = t => { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
const clamp01 = t => Math.max(0, Math.min(1, t));

export function installSaver(api) {
  let S = null, src = null;
  const srcP = fetch(new URL('./upstream/main.js', import.meta.url)).then(r => r.text()).then(t => { src = t; }).catch(() => {});

  // ── the plant buffer ─────────────────────────────────────────────────────
  function feed() {
    // BUF counts the plants not shown yet, so new plants keep coming for
    // the whole run. Shown plants go when the list passes BUF + 6.
    while (S && S.inflight < AHEAD && S.plants.filter(q => !q.shown).length + S.inflight < BUF) {
      const seed = S.seeds[S.si++ % S.seeds.length];
      S.inflight++;
      api.pool.paint(seed, { prio: 2, tag: 'saver' }).then(p => {
        if (!S) return;
        S.inflight--;
        S.plants.push({ p, shown: 0 });
        while (S.plants.length > BUF + 6) {
          const old = S.plants.findIndex(q => q.shown > 0);
          if (old < 0) break;
          S.plants.splice(old, 1);
        }
        feed();
        if (!S.shot && S.phase === 'wait') direct();
      }).catch(() => { if (S) { S.inflight--; setTimeout(feed, 200); } });
    }
  }
  // Least-shown first, then oldest.
  function take(n, pref) {
    const pool = S.plants.slice().sort((a, b) => a.shown - b.shown);
    let out = pool.slice(0, n);
    if (pref === 'mixed' && n === 2) {
      const w = pool.find(q => q.p.type === 'woody'), h = pool.find(q => q.p.type === 'herbal');
      if (w && h) out = [w, h];
    }
    out.forEach(q => q.shown++);
    return out.map(q => q.p);
  }

  // ── the director ─────────────────────────────────────────────────────────
  function direct(force) {
    let type = force && NEED[force] ? force : null;
    if (!type) {
      for (let tries = 0; tries < DECK.length * 2 && !type; tries++) {
        if (S.di >= S.deck.length) { S.deck = shuffle(DECK, S.rng); S.di = 0; }
        const t = S.deck[S.di++];
        if (S.plants.length >= NEED[t] && t !== S.lastType) type = t;
      }
    }
    if (!type || S.plants.length < NEED[type]) {
      if (S.plants.length >= 1) type = 'grow';
      else { S.shot = null; S.phase = 'wait'; S.waits++; return; }
    }
    const calmS = Math.max(5, Math.min(12, 5 + 7 * S.calm + (S.rng() * 2 - 1) * 1.2));
    const dur = 1000 * (type === 'herb' ? Math.min(12, calmS + 2) : calmS);
    const n = type === 'herb' ? (S.plants.length >= 6 && (isShort() || S.rng() < 0.6) ? 6 : 4) : NEED[type];
    const plants = take(n, type === 'pair' ? 'mixed' : null);
    const shot = { type, plants, dur, t0: performance.now(), wob: S.rng() * 6.28, beat: '' };
    if (type === 'herb') shot.pick = Math.floor(S.rng() * plants.length);
    S.lastType = type; S.shot = shot; S.phase = 'run'; S.count++;
    plate(shot);
    feed();
  }

  // ── plate ────────────────────────────────────────────────────────────────
  function plate(shot) {
    const p = shot.type === 'herb' ? shot.plants[shot.pick] : shot.plants[0];
    const par = p.par || {}, num = k => (par[k] ? par[k].value : null);
    const petals = num('flowerPetal'), chance = num('flowerChance');
    const plantLine = p.type === 'woody'
      ? `A woody plant: fractal branches, depth ${num('branchDepth')}, up to ${num('branchFork')} forks each.`
      : `A herbal plant: ${num('stemCount')} stems from one root, each with shoots that end in a flower.`;
    const lines = {
      grow: [plantLine, 'The brush grows the painting from the root up.'],
      detail: [plantLine, 'Each petal is a leaf() with no veins, bent by the open curve.'],
      herb: [`A herbarium of ${shot.plants.length} sheets. Each plant is woody or herbal with even odds.`, `Sheet ${shot.pick + 1}: seed ${p.seed}, ${p.type}.`],
      pair: [`Seed ${shot.plants[0].seed} (${shot.plants[0].type}) and seed ${shot.plants[1] ? shot.plants[1].seed + ' (' + shot.plants[1].type + ')' : ''}.`, 'Two plants from two seeds; each seed gives the same painting every time.'],
    }[shot.type];
    // Two note lines and a 6-line code extract keep the base plate short,
    // so the clear band stays as tall as it can at 1280 x 800.
    if (shot.type !== 'herb') lines.push(`Same plant: lingdong-.github.io/nonflowers/?seed=${p.token}`);
    const fn = { grow: p.type, detail: 'leaf', herb: 'generate', pair: 'genParams' }[shot.type];
    S.label({
      title: 'Nonflowers',
      sub: 'by Lingdong Huang (MIT) · github.com/LingDong-/nonflowers',
      params: [
        { name: 'seed', value: p.seed },
        { name: 'plant', value: p.type },
        { name: 'petals', value: petals == null ? '-' : String(petals) },
        { name: 'flower chance', value: chance == null ? '-' : chance.toFixed(3) },
      ],
      lines,
      code: src ? { lang: 'js', name: `upstream/main.js · ${fn}()`, text: codeExtract(src, fn, 6) } : undefined,
      anchor: () => null,
    });
  }

  // ── geometry ─────────────────────────────────────────────────────────────
  // The clear band in device px.
  function band(dpr) {
    const W = innerWidth, H = innerHeight, b = S.band;
    const t = b ? b.t : H * 0.16, bot = b ? b.b : H * 0.18, side = Math.max(16, W * 0.04);
    return { x: side * dpr, y: t * dpr, w: Math.max(120, W - 2 * side) * dpr, h: Math.max(120, H - t - bot) * dpr };
  }
  // A square mat (the painting and PAD of paper) of the largest size that
  // fits rect r, centred. k0 <= KMAX.
  function matIn(r) {
    const m = SIZE + 2 * PAD, k0 = Math.min(KMAX, Math.min(r.w, r.h) / m), s = m * k0;
    return { x: r.x + (r.w - s) / 2, y: r.y + (r.h - s) / 2, w: s, h: s, k0 };
  }
  // A short band (wider than 2.6 : 1, for example 1280 x 800 with the
  // plate on): a square mat there is small, so grow and detail use a wide
  // window and pan along the plant at a scale that fills the window width.
  function isShort() { const B = band(Math.min(2, devicePixelRatio || 1)); return B.w > 2.6 * B.h; }
  // A window of aspect at most asp : 1 inside the band.
  function wideIn(r, asp = 2.1) {
    const w = Math.min(r.w, r.h * asp);
    return { x: r.x + (r.w - w) / 2, y: r.y, w, h: r.h };
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  // One view of a plant: frame rect F (device px), device scale k, and the
  // painting point (cx, cy) at the centre of F. T < 1: the brush wipe.
  function view(g, p, F, k, cx, cy, T, wob, el, alpha = 1) {
    k = Math.min(k, KMAX);
    const ox = F.x + F.w / 2 - cx * k, oy = F.y + F.h / 2 - cy * k;
    g.save();
    g.globalAlpha = alpha;
    g.beginPath(); g.rect(F.x, F.y, F.w, F.h); g.clip();
    const pat = g.createPattern(p.bg, 'repeat');
    if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().translate(ox, oy).scale(k));
    g.fillStyle = pat || '#e9e2cf'; g.fillRect(F.x, F.y, F.w, F.h);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const ps = SIZE * k;
    if (T >= 1) g.drawImage(p.painting, ox, oy, ps, ps);
    else {
      // The bare sheet first, so only the plant ink grows.
      if (p.blank) g.drawImage(p.blank, ox, oy, ps, ps);
      if (T > 0) g.drawImage(grown(p, ps, T, wob, el), ox, oy, ps, ps);
    }
    g.restore();
    return { ox, oy, k };
  }
  // The painting at ps device px under the growth mask: an ellipse from the
  // root, taller than wide, with a soft edge of 90 painting px and a slow
  // wobble on its rim. The mask canvas is reused for each call.
  function grown(p, ps, T, wob, el) {
    const m = S.mask, n = Math.max(2, Math.min(2400, Math.ceil(ps)));
    if (m.width !== n) { m.width = n; m.height = n; }
    const mg = m.getContext('2d'), k = n / SIZE;
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.globalCompositeOperation = 'source-over';
    mg.clearRect(0, 0, n, n);
    mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high';
    mg.drawImage(p.painting, 0, 0, n, n);
    mg.globalCompositeOperation = 'destination-in';
    const R = 780 * k * T, feather = 90 * k;
    mg.translate(p.base[0] * k, Math.min(SIZE, p.base[1]) * k); mg.scale(0.8, 1.15);
    const rg = mg.createRadialGradient(0, 0, Math.max(0, R - feather), 0, 0, R + 1);
    rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    mg.fillStyle = rg;
    mg.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2, w = 1 + 0.05 * Math.sin(5 * a + wob + el / 900) + 0.03 * Math.sin(11 * a - el / 600);
      const r = (R + 2) * w;
      i ? mg.lineTo(Math.cos(a) * r, Math.sin(a) * r) : mg.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    mg.closePath(); mg.fill();
    return m;
  }
  function shadow(g, F, dpr) {
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 26 * dpr; g.shadowOffsetY = 8 * dpr;
    g.fillStyle = '#0c0d10'; g.fillRect(F.x, F.y, F.w, F.h); g.restore();
  }
  // The close zoom for a focus window of radius r in frame F: the window
  // fills about 70% of the short side, within KMAX.
  const closeK = (F, r) => Math.min(KMAX, 0.7 * Math.min(F.w, F.h) / (2 * Math.max(r, 60)));
  const flowerOf = p => (p.focus && p.focus.ink > 0.12 ? p.focus : null);
  const leafOf = p => (p.leaf && p.leaf.ink > 0.06 ? p.leaf : null);
  // Keep the camera window on the sheet: the view centre stays far enough
  // from the painting edge (with 20 px of slack) for the window to fit.
  function clampCam(F, k, cx, cy) {
    const hw = F.w / 2 / k, hh = F.h / 2 / k, lo = 20, hi = SIZE - 20;
    const cl = (v, h) => (2 * h >= hi - lo ? SIZE / 2 : Math.max(lo + h, Math.min(hi - h, v)));
    return [cl(cx, hw), cl(cy, hh)];
  }

  // ── shots ────────────────────────────────────────────────────────────────
  function drawGrow(g, s, el, B, dpr) {
    if (B.w > 2.6 * B.h) { drawGrowStrip(g, s, el, B, dpr); return; }
    const p = s.plants[0], M = matIn(B), u = el / s.dur;
    shadow(g, M, dpr);
    const T = ease(u / 0.45), f = flowerOf(p) || leafOf(p) || { x: SIZE / 2, y: SIZE * 0.5, r: 160 };
    const zt = ease((u - 0.45) / 0.55);
    const k = M.k0 + (closeK(M, f.r) - M.k0) * Math.max(0, zt);
    const [cx, cy] = clampCam(M, k, SIZE / 2 + (f.x - SIZE / 2) * zt, SIZE / 2 + (f.y - SIZE / 2) * zt);
    s.beat = u < 0.45 ? 'grow' : flowerOf(p) ? 'push flower' : 'push leaves'; s.k = k; s.F = M;
    view(g, p, M, k, cx, cy, T, s.wob, el);
  }
  // The grow shot in a short band: a wide window at a scale that fills its
  // width. The camera tilts from the root up with the brush, then pushes
  // in on the flower head (or the leaves).
  function drawGrowStrip(g, s, el, B, dpr) {
    const p = s.plants[0], F = wideIn(B, 3.4), u = el / s.dur;
    shadow(g, F, dpr);
    const kW = Math.min(KMAX, F.w / (SIZE * 0.92));
    // The brush starts a little open, so the first frame already shows ink.
    const T = ease(0.12 + u / 0.6), f = flowerOf(p) || leafOf(p) || { x: SIZE / 2, y: SIZE * 0.4, r: 160 };
    const tilt = ease(u / 0.6), zt = ease((u - 0.6) / 0.4);
    const k = Math.max(kW, kW + (Math.min(KMAX, closeK(F, f.r) * 1.6) - kW) * zt);
    const cy0 = Math.min(SIZE, p.base[1]) - 130, cy = cy0 + (f.y - cy0) * tilt;
    const [cx, cyc] = clampCam(F, k, SIZE / 2 + (f.x - SIZE / 2) * zt, cy);
    s.beat = u < 0.6 ? 'grow tilt' : flowerOf(p) ? 'push flower' : 'push leaves'; s.k = k; s.F = F;
    view(g, p, F, k, cx, cyc, T, s.wob, el);
  }
  function drawDetail(g, s, el, B, dpr) {
    s.short = B.w > 2.6 * B.h;
    const p = s.plants[0], F = wideIn(B, s.short ? 3.4 : 2.1), u = el / s.dur;
    shadow(g, F, dpr);
    const kFit = Math.min(KMAX, F.h / (SIZE + 2 * PAD));
    // In a short band no view goes below the width-fill scale kW.
    const kW = s.short ? Math.min(KMAX, F.w / (SIZE * 0.92)) : 0;
    const fl = flowerOf(p), lf = leafOf(p);
    // Beats: the whole plant, then a close look at each focus there is
    // (flower head, stems and leaves). With one focus, a second, closer
    // look at it from a little higher.
    const close = (f, z, dy) => q => { const k = Math.max(kW, Math.min(KMAX, closeK(F, f.r) * z * (s.short ? 1.6 : 1) * (0.92 + 0.08 * q))); const [cx, cy] = clampCam(F, k, f.x + 8 * q, f.y + dy * (1 - q)); return { k, cx, cy }; };
    const foci = [fl && ['flower', fl], lf && ['leaves', lf]].filter(Boolean);
    if (!foci.length) foci.push(['middle', { x: SIZE / 2, y: SIZE * 0.5, r: 150 }]);
    const looks = foci.length > 1 ? [[foci[0][0], close(foci[0][1], 1, 0)], [foci[1][0], close(foci[1][1], 0.85, 0)]]
      : [[foci[0][0], close(foci[0][1], 0.7, 0)], [foci[0][0] + ' closer', close(foci[0][1], 1.15, -30)]];
    const beats = [
      s.short ? { name: 'pan down', t: 0.32, cam: q => { const [cx, cy] = clampCam(F, kW, SIZE / 2, SIZE * (0.2 + 0.6 * q)); return { k: kW, cx, cy }; } }
        : { name: 'whole', t: 0.32, cam: q => ({ k: kFit * (1 + 0.06 * q), cx: SIZE / 2, cy: SIZE / 2 }) },
      { name: looks[0][0], t: 0.66, cam: looks[0][1] },
      { name: looks[1][0], t: 1, cam: looks[1][1] },
    ];
    let i = beats.findIndex(b => u < b.t); if (i < 0) i = beats.length - 1;
    const b0 = i ? beats[i - 1].t : 0, q = clamp01((u - b0) / (beats[i].t - b0));
    const c = beats[i].cam(q);
    s.beat = beats[i].name; s.k = c.k; s.F = F;
    view(g, p, F, c.k, c.cx, c.cy, 1, s.wob, el);
    // A short cross-fade from the last beat.
    const since = (u - b0) * s.dur;
    if (i && since < XFADE_MS) { const pc = beats[i - 1].cam(1); view(g, p, F, pc.k, pc.cx, pc.cy, 1, s.wob, el, 1 - since / XFADE_MS); }
  }
  function drawHerb(g, s, el, B, dpr) {
    const n = s.plants.length, gap = 14 * dpr;
    // The column count that gives the largest sheets in this band.
    let cols = 1, cell = 0;
    for (let c = 1; c <= n; c++) {
      if (n % c && c !== n) continue;
      const r = Math.ceil(n / c), z = Math.min((B.w - gap * (c - 1)) / c, (B.h - gap * (r - 1)) / r);
      if (z > cell) { cell = z; cols = c; }
    }
    const rows = Math.ceil(n / cols);
    const gw = cols * cell + gap * (cols - 1), gh = rows * cell + gap * (rows - 1);
    const gx = B.x + (B.w - gw) / 2, gy = B.y + (B.h - gh) / 2, u = el / s.dur;
    const fillEnd = 0.6, per = fillEnd / (n + 1.2);
    // The push into one sheet after the fill: the grid scales about it.
    const zt = ease((u - 0.66) / 0.34);
    const pc = s.pick % cols, pr = Math.floor(s.pick / cols);
    const tx = gx + pc * (cell + gap) + cell / 2, ty = gy + pr * (cell + gap) + cell / 2;
    // The picked sheet grows past the band (the band clips it), so the push
    // is a real close look even when one row of sheets already fills the band.
    const zMax = Math.min(KMAX / Math.max(1e-6, cell / (SIZE + 2 * PAD)), Math.max(1.6, Math.min(2.6, B.h / cell * 1.9)));
    const z = 1 + (zMax - 1) * zt;
    const mx = B.x + B.w / 2, my = B.y + B.h / 2;
    s.beat = u < fillEnd ? 'fill' : u < 0.66 ? 'hold' : 'push'; s.F = B;
    g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x0 = gx + c * (cell + gap), y0 = gy + r * (cell + gap);
      // Cell rect after the zoom about (tx, ty), moved so (tx, ty) goes to the band centre.
      const X = (x0 - tx) * z + tx + (mx - tx) * zt, Y = (y0 - ty) * z + ty + (my - ty) * zt, C = cell * z;
      const T = ease((u - i * per) / (per * 2.2));
      if (T <= 0) { g.fillStyle = 'rgba(233,226,207,0.06)'; g.fillRect(X, Y, C, C); continue; }
      const F = { x: X, y: Y, w: C, h: C }, k = C / (SIZE + 2 * PAD);
      if (i === s.pick) s.k = k;
      g.save(); g.globalAlpha = Math.min(1, T * 3); shadow(g, F, dpr); g.restore();
      view(g, s.plants[i], F, k, SIZE / 2, SIZE / 2, T, s.wob + i, el, Math.min(1, T * 3));
    }
    g.restore();
  }
  function drawPair(g, s, el, B, dpr) {
    if (B.w > 2.6 * B.h) { drawPairStrip(g, s, el, B, dpr); return; }
    // Two mats side by side, close together in the middle of the band.
    const gap = 28 * dpr, side = Math.min((B.w - gap) / 2, B.h), x0 = B.x + (B.w - 2 * side - gap) / 2, u = el / s.dur;
    s.beat = u < 0.5 ? 'grow' : 'hold'; s.F = B;
    s.plants.forEach((p, i) => {
      const M = matIn({ x: x0 + i * (side + gap), y: B.y, w: side, h: B.h });
      shadow(g, M, dpr);
      const T = ease((u - i * 0.08) / 0.45), z = 1 + 0.08 * ease((u - 0.5) / 0.5);
      if (!i) s.k = M.k0 * z;
      view(g, p, M, M.k0 * z, SIZE / 2, SIZE / 2, T, s.wob + i * 2, el);
    });
  }

  // The pair in a short band: two wide windows, each at the scale that
  // fills its width, tilt from the stems up to the flower heads.
  function drawPairStrip(g, s, el, B, dpr) {
    const gap = 28 * dpr, w = Math.min((B.w - gap) / 2, B.h * 1.8), x0 = B.x + (B.w - 2 * w - gap) / 2, u = el / s.dur;
    s.beat = u < 0.55 ? 'grow tilt' : 'hold'; s.F = B;
    s.plants.forEach((p, i) => {
      const F = { x: x0 + i * (w + gap), y: B.y, w, h: B.h }, k = Math.min(KMAX, w / (SIZE * 0.92));
      shadow(g, F, dpr);
      const f = flowerOf(p) || leafOf(p) || { x: SIZE / 2, y: SIZE * 0.4 };
      const T = ease(0.12 + (u - i * 0.08) / 0.5), q = ease((u - i * 0.08) / 0.6);
      const cy0 = Math.min(SIZE, p.base[1]) - 130, [cx, cy] = clampCam(F, k, SIZE / 2, cy0 + (f.y - cy0) * q);
      if (!i) s.k = k;
      view(g, p, F, k, cx, cy, T, s.wob + i * 2, el);
    });
  }
  function frame(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    if (S.bandFn && now - S.bandAt > 300) { S.bandAt = now; S.band = S.bandFn(innerHeight); }
    const c = S.canvas, dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d'), s = S.shot;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0c0d10'; g.fillRect(0, 0, cw, ch);
    if (!s) return;
    const el = Math.min(now - s.t0, s.dur), B = band(dpr);
    ({ grow: drawGrow, detail: drawDetail, herb: drawHerb, pair: drawPair })[s.type](g, s, el, B, dpr);
    // Fade in at the start, fade out at the end, then the next shot.
    const tail = s.dur - (now - s.t0), head = now - s.t0;
    const a = head < 400 ? 1 - head / 400 : tail < FADE_MS ? 1 - Math.max(0, tail) / FADE_MS : 0;
    if (a > 0) { g.globalAlpha = a; g.fillStyle = '#0c0d10'; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1; }
    if (tail <= 0) direct();
  }

  window.snSaver = {
    enter(o = {}) {
      if (S) this.exit();
      api.enter();
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      const rng = mulberry((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1));
      const seeds = Array.from({ length: 96 }, () => randomSeed(rng));
      const st = document.createElement('style'); st.id = 'nfSaverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#caption,#tools,#herb,#mat,#prog,#toast{display:none!important}#desk{top:0!important;bottom:0!important}html,body{cursor:none}' +
        '#nfSaver{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:100}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'nfSaver';
      document.body.append(canvas);
      S = { calm, rng, seeds, si: 0, deck: shuffle(DECK, rng), di: 0, plants: [], inflight: 0, canvas, mask: document.createElement('canvas'), style: st,
        label: typeof o.label === 'function' ? o.label : () => {}, band: null, bandFn: null, bandAt: 0, shot: null, phase: 'wait', waits: 0, count: 0, lastType: '' };
      // The plants the page already painted go first into the buffer.
      // A recent seed that is still painting goes to the front of the list,
      // so the first saver job joins that job instead of starting cold.
      for (const seed of api.recent ? api.recent() : []) {
        const p = api.pool.cached(seed);
        if (p) { if (S.plants.length < 4) S.plants.push({ p, shown: 0 }); } else S.seeds.unshift(seed);
      }
      import('../../lib/saver-clear.js').then(m => { if (S) S.bandFn = m.plateBand; }).catch(() => { /* no shell: the centre band */ });
      srcP.then(() => { if (S && S.shot) plate(S.shot); });
      feed();
      if (S.plants.length) direct();
      S.raf = requestAnimationFrame(frame);
      return { canvas, warmupMs: S.plants.length ? 600 : 3200 };
    },
    exit() {
      if (!S) return;
      cancelAnimationFrame(S.raf);
      try { S.label(null); } catch (e) { /* the shell is gone */ }
      api.pool.cancel('saver');
      S.canvas.remove(); S.style.remove();
      S = null;
      api.exit();
    },
    // For CDP probes: the shot on screen, its beat, frame and zoom.
    debug() {
      if (!S) return { phase: 'off' };
      const s = S.shot, dpr = Math.min(2, devicePixelRatio || 1);
      return { phase: S.phase, count: S.count, waits: S.waits, buffer: S.plants.length, inflight: S.inflight, band: S.band,
        shot: s ? { type: s.type, beat: s.beat, seeds: s.plants.map(p => p.seed), types: s.plants.map(p => p.type), k: s.k, kOk: !(s.k > KMAX + 1e-6),
          frame: s.F ? { x: s.F.x / dpr, y: s.F.y / dpr, w: s.F.w / dpr, h: s.F.h / dpr } : null, t: Math.round(performance.now() - s.t0), dur: Math.round(s.dur) } : null };
    },
    cut(type) { if (S) direct(type); return this.debug(); },
  };
}
