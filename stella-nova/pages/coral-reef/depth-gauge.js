// ============================================================================
//  CORAL REEF  ·  depth-gauge.js  ·  the region picker over the minimap
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "those options should be available
//  beautifully above the mapshown graphically like an ocean getting
//  deeper. ensure mobile layout looks good". The options are the five
//  "Go to a region" chips of the Explore section (main.js goRegion). They
//  stay in the panel; this gauge gives the same five targets over the map.
//
//  THE PICTURE. A stylised cross-section of the ocean: the sea surface with
//  light rays, a water colour from turquoise shallows through reef blue,
//  twilight indigo and abyss near black to trench black, a seafloor that
//  slopes down with a reef bump, a drop-off and a trench notch, and marine
//  snow in the deep bands. Five bands (name and depth range) are buttons:
//  a click or a tap calls o.goRegion(id), the same path as the panel chips.
//  The band of the region of the selected ROV (W.regionAt) is "on".
//
//  THE SCALE (gaugeU). Each band gets one fifth of the gauge; inside a band
//  the depth is on a log scale (log10(1 + d)), as the minimap legend. A
//  marker in the colour of the selected ROV shows its depth (a CSS glide
//  between updates); the other ROVs are dots at their depths.
//
//  PLACES (gaugePlace, pure). Desktop: vertical, directly above the minimap,
//  the same left and width; it folds with the minimap and keeps clear of
//  the camera bar. Phones: a horizontal strip (surface left, deep right)
//  at the top, 56 px high (44 px targets or more); the page sets --dg-h
//  (left column) and --dg-hr (right column) so that the minimap, the
//  colour legend, the hint and the readout move down under the strip
//  (hud.css PHONE). The saver hides the gauge (hud.css SAVER).
//
//  COST. The canvas draws again only for a new size, region, hover or
//  fold. The markers are DOM: 4 updates a second at most, and only for a
//  depth change over 0.5 px.
//
//  grep -n targets
//    "export const GAUGE_BANDS"     the five bands: id, name, depth range
//    "export function gaugeU"       depth (m) -> 0..1 on the gauge; "gaugeDepth"
//    "export const SEAFLOOR"        the seafloor profile (distance, u)
//    "export function gaugePlace"   the rect of the gauge (pure)
//    "export function drawGauge"    one canvas draw
//    "export function mountDepthGauge"
// ============================================================================

export const GAUGE_BANDS = [
  { id: 'shallows', name: 'Shallows', a: 0, b: 15, range: '0–15 m' },
  { id: 'reef', name: 'Reef', a: 15, b: 100, range: '15–100 m' },
  { id: 'twilight', name: 'Twilight', a: 100, b: 1000, range: '100 m–1 km' },
  { id: 'abyss', name: 'Abyss', a: 1000, b: 3500, range: '1–3.5 km' },
  { id: 'trench', name: 'Trench', a: 3500, b: 6000, range: '3.5–6 km' },
];
const NB = GAUGE_BANDS.length;
const lg = (d) => Math.log10(1 + Math.max(0, d));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// depth (m) -> 0 (the surface) .. 1 (6 km): equal bands, log inside each
export function gaugeU(d) {
  d = Math.max(0, d);
  for (let i = 0; i < NB; i++) {
    const B = GAUGE_BANDS[i];
    if (d <= B.b || i === NB - 1) return clamp((i + (lg(Math.min(d, B.b)) - lg(B.a)) / (lg(B.b) - lg(B.a))) / NB, 0, 1);
  }
  return 1;
}
export function gaugeDepth(u) {
  u = clamp(u, 0, 1);
  const i = Math.min(NB - 1, Math.floor(u * NB)), B = GAUGE_BANDS[i], f = u * NB - i;
  return Math.pow(10, lg(B.a) + f * (lg(B.b) - lg(B.a))) - 1;
}

// the water colour by u: turquoise, reef blue, twilight indigo, abyss, black
export const GAUGE_STOPS = [[0, [126, 236, 222]], [0.2, [38, 172, 198]], [0.4, [26, 94, 168]], [0.6, [40, 38, 112]], [0.8, [12, 12, 34]], [1, [2, 2, 6]]];
export function gaugeColour(u) {
  const S = GAUGE_STOPS;
  for (let i = 1; i < S.length; i++) if (u <= S[i][0]) {
    const t = clamp((u - S[i - 1][0]) / (S[i][0] - S[i - 1][0]), 0, 1);
    return S[i][1].map((c, k) => Math.round(S[i - 1][1][k] + (c - S[i - 1][1][k]) * t));
  }
  return S[S.length - 1][1].slice();
}

// the seafloor: [distance from the shore 0..1, u]: the shelf, a reef bump,
// the drop-off, the twilight slope, the abyssal plain and a trench notch
export const SEAFLOOR = [
  [0, 0.03], [0.08, 0.07], [0.16, 0.13], [0.21, 0.2], [0.25, 0.25], [0.28, 0.23], [0.31, 0.225], [0.34, 0.27],
  [0.37, 0.36], [0.4, 0.43], [0.43, 0.56], [0.48, 0.66], [0.56, 0.74], [0.65, 0.79], [0.74, 0.815],
  [0.79, 0.83], [0.82, 0.88], [0.845, 0.975], [0.865, 0.99], [0.885, 0.975], [0.905, 0.86], [0.94, 0.83], [1, 0.835],
];

// The rect of the gauge (CSS px). o: { vw, vh, phone, inFrame, fold,
// mapFold, mm: minimap rect, bar: camera bar rect | null }.
// Returns { x, y, w, h, horiz, show, shiftL, shiftR }.
export const DG_HEAD = 22, DG_STRIP = 56, DG_FOLDW = 44;
export function gaugePlace(o) {
  const { vw, vh } = o;
  if (o.phone) {
    const land = vh <= 500 && vw > vh, y = land || o.inFrame ? 8 : 52;
    const w = o.fold ? 150 : land ? Math.min(400, Math.round(vw * 0.46)) : vw - 16, h = o.fold ? 44 : DG_STRIP;
    return { x: 8, y, w, h, horiz: true, show: true, shiftL: h + 6, shiftR: land ? 0 : h + 6 };
  }
  const mm = o.mm;
  if (!mm || !(mm.width > 0) || o.mapFold) return { x: 0, y: 0, w: 0, h: 0, horiz: false, show: false, shiftL: 0, shiftR: 0 };
  const top = mm.top - 6;
  // the camera bar (top centre): keep under it where the two meet in x
  const b = o.bar, minTop = b && b.bottom > 0 && b.right > mm.left && b.left < mm.right ? b.bottom + 8 : 8;
  if (o.fold) return { x: mm.left, y: top - DG_HEAD - 8, w: mm.width, h: DG_HEAD + 8, horiz: false, show: top - DG_HEAD - 8 >= minTop, shiftL: 0, shiftR: 0 };
  const want = clamp(Math.round(mm.width * 0.6), 130, 210), h = Math.min(want, top - minTop);
  return { x: mm.left, y: top - h, w: mm.width, h, horiz: false, show: h >= 96, shiftL: 0, shiftR: 0 };
}

// ── one draw ────────────────────────────────────────────────────────────────
// s: { w, h, horiz, cur: region id | null, hover: id | null }. Vertical:
// the surface at the top, the shore at the left; horizontal: the surface at
// the left, the shore at the bottom. Returns the band rects (CSS px).
export function drawGauge(ctx, s) {
  const { w, h, horiz } = s;
  const P = (d, u) => (horiz ? [u * w, (1 - d) * h] : [d * w, u * h]);
  const span = (u0, u1) => (horiz ? [u0 * w, 0, (u1 - u0) * w, h] : [0, u0 * h, w, (u1 - u0) * h]);
  const lin = (u0, u1) => { const a = P(0, u0), b = P(0, u1); return horiz ? ctx.createLinearGradient(a[0], 0, b[0], 0) : ctx.createLinearGradient(0, a[1], 0, b[1]); };
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  // the water
  const g = lin(0, 1);
  for (let i = 0; i <= 20; i++) { const c = gaugeColour(i / 20); g.addColorStop(i / 20, `rgb(${c[0]},${c[1]},${c[2]})`); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // light rays from the surface, gone by the twilight
  const rg = lin(0, 0.42); rg.addColorStop(0, 'rgba(225,255,248,0.22)'); rg.addColorStop(1, 'rgba(225,255,248,0)');
  ctx.fillStyle = rg;
  for (let k = 0; k < 5; k++) {
    const d0 = 0.18 + k * 0.17, a = P(d0, 0), b = P(d0 + 0.05, 0), c = P(d0 + 0.13, 0.42), e = P(d0 + 0.02, 0.42);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.closePath(); ctx.fill();
  }
  // marine snow in the deep bands (seeded: the same specks each draw)
  let r = 9781;
  const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 70; k++) {
    const u = 0.42 + rnd() * 0.58, d = rnd(), q = P(d, u);
    ctx.fillStyle = `rgba(200,225,235,${(0.18 + rnd() * 0.32).toFixed(2)})`;
    ctx.fillRect(q[0], q[1], 0.6 + rnd() * 0.9, 0.6 + rnd() * 0.9);
  }
  // the band of the current region and the band under the pointer
  const rects = [];
  GAUGE_BANDS.forEach((B, i) => {
    const R = span(i / NB, (i + 1) / NB);
    rects.push({ id: B.id, x: R[0], y: R[1], w: R[2], h: R[3] });
    if (B.id === s.cur) { ctx.fillStyle = 'rgba(127,224,207,0.16)'; ctx.fillRect(R[0], R[1], R[2], R[3]); }
    else if (B.id === s.hover) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(R[0], R[1], R[2], R[3]); }
  });
  // the seafloor: rock under the profile
  ctx.beginPath();
  SEAFLOOR.forEach(([d, u], i) => { const q = P(d, u); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
  let q = P(1, 1); ctx.lineTo(q[0], q[1]); q = P(0, 1); ctx.lineTo(q[0], q[1]); ctx.closePath();
  const rk = lin(0, 1); rk.addColorStop(0, 'rgba(58,62,60,0.94)'); rk.addColorStop(0.35, 'rgba(26,30,40,0.94)'); rk.addColorStop(1, 'rgba(5,5,8,0.97)');
  ctx.fillStyle = rk; ctx.fill();
  const ed = lin(0, 1); ed.addColorStop(0, 'rgba(236,214,160,0.75)'); ed.addColorStop(0.4, 'rgba(150,170,190,0.45)'); ed.addColorStop(1, 'rgba(120,130,170,0.25)');
  ctx.strokeStyle = ed; ctx.lineWidth = 1.2;
  ctx.beginPath(); SEAFLOOR.forEach(([d, u], i) => { const p = P(d, u); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
  // coral on the reef bump
  for (const [d, u, c] of [[0.27, 0.228, '#ff9a7a'], [0.295, 0.221, '#ffc27a'], [0.315, 0.223, '#f07cb0']]) {
    const p = P(d, u); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.4, Math.min(w, h) * 0.012), 0, Math.PI * 2); ctx.fill();
  }
  // the band lines
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < NB; i++) { const a = P(0, i / NB), b = P(1, i / NB); ctx.moveTo(Math.round(a[0]) + 0.5, Math.round(a[1]) + 0.5); ctx.lineTo(Math.round(b[0]) + 0.5, Math.round(b[1]) + 0.5); }
  ctx.stroke();
  // the sea surface: a bright, gently waved line
  ctx.strokeStyle = 'rgba(225,255,250,0.95)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let k = 0; k <= 40; k++) { const p = P(k / 40, 0.004 + 0.004 * Math.sin(k * 1.3)); if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
  ctx.stroke();
  ctx.restore();
  return { bands: rects };
}

// ── the gauge on the page ──────────────────────────────────────────────────
// o: { doc, win, goRegion(id), phoneQ, isSaver(), mapFolded(), inFrame?,
//      state() -> { rovs: [{ id, depth, colour, sel }], region: id | null } }
export function mountDepthGauge(o) {
  const { doc, win } = o;
  const mmBox = doc.getElementById('minimap');
  if (!mmBox) return null;
  const el = doc.createElement('div');
  el.id = 'depthGauge'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Go to a region: the ocean from the surface to the trench');
  el.innerHTML = '<div class="dg-head"><span class="dg-title">Dive to</span><b class="dg-now"></b>'
    + '<button id="dgFold" type="button" aria-expanded="true" aria-controls="dgBody" title="Show or hide the depth gauge"><span aria-hidden="true">▾</span><span class="sr">Depth gauge</span></button></div>'
    + '<div class="dg-body" id="dgBody"><canvas class="dg-cv" aria-hidden="true"></canvas><div class="dg-bands"></div><div class="dg-marks" aria-hidden="true"></div></div>';
  mmBox.after(el);
  const cv = el.querySelector('.dg-cv'), bandsEl = el.querySelector('.dg-bands'), marks = el.querySelector('.dg-marks'), now = el.querySelector('.dg-now'), fb = el.querySelector('#dgFold');
  for (const B of GAUGE_BANDS) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'dg-band'; b.dataset.region = B.id;
    b.title = `${B.name} · ${B.range} deep: send the squad there`;
    b.setAttribute('aria-label', `${B.name}, ${B.range.replace('–', ' to ')} deep. Send the squad there`);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<b>${B.name}</b><span>${B.range}</span>`;
    b.addEventListener('click', () => { if (o.goRegion) o.goRegion(B.id); });
    b.addEventListener('pointerenter', () => { hover = B.id; dirty = true; });
    b.addEventListener('pointerleave', () => { if (hover === B.id) { hover = null; dirty = true; } });
    bandsEl.appendChild(b);
  }
  let fold = false, hover = null, dirty = true, t = 1, place = null, cur = null, key = '';
  const markEls = new Map(), shown = new Map();
  try { fold = win.localStorage.getItem('coral-reef-gauge-fold') === '1'; } catch { /* the default */ }
  fb.addEventListener('click', () => {
    fold = !fold; dirty = true; t = 1;
    try { win.localStorage.setItem('coral-reef-gauge-fold', fold ? '1' : '0'); } catch { /* not kept */ }
    tick(0);
  });
  const phone = () => !!(o.phoneQ && o.phoneQ.matches);
  const setVars = (l, r) => { const s = doc.documentElement.style; s.setProperty('--dg-h', `${l}px`); s.setProperty('--dg-hr', `${r}px`); };
  // the body size (CSS px) from the place: the head row (desktop) or the
  // fold button (phone) take a part
  const bodySize = (p) => (p.horiz ? [p.w - 2 - DG_FOLDW, p.h - 2] : [p.w - 2, p.h - 2 - DG_HEAD]);

  function layout() {
    const vw = win.innerWidth || 1280, vh = win.innerHeight || 720;
    let mm = null, bar = null;
    try { mm = mmBox.getBoundingClientRect(); } catch { /* no layout */ }
    try { const cb = doc.getElementById('camBar'); bar = cb ? cb.getBoundingClientRect() : null; } catch { /* no layout */ }
    const p = gaugePlace({ vw, vh, phone: phone(), inFrame: doc.documentElement.classList.contains('in-frame'), fold, mapFold: !!(o.mapFolded && o.mapFolded()), mm, bar });
    const saver = !!(o.isSaver && o.isSaver());
    const k = JSON.stringify(p) + fold + saver;
    if (k !== key) {
      key = k; dirty = true;
      el.classList.toggle('dg-horiz', p.horiz); el.classList.toggle('dg-fold', fold); el.hidden = !p.show || saver;
      fb.setAttribute('aria-expanded', String(!fold));
      Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
      if (p.show && !saver) setVars(p.shiftL, p.shiftR); else setVars(0, 0);
    }
    place = p;
    return p;
  }
  function draw() {
    const p = place; if (!p || el.hidden || fold) return;
    const [bw, bh] = bodySize(p), dpr = Math.min(3, win.devicePixelRatio || 1);
    if (cv.width !== Math.round(bw * dpr) || cv.height !== Math.round(bh * dpr)) { cv.width = Math.round(bw * dpr); cv.height = Math.round(bh * dpr); }
    const ctx = cv.getContext ? cv.getContext('2d') : null;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGauge(ctx, { w: bw, h: bh, horiz: p.horiz, cur, hover });
  }
  function marksNow(st) {
    const p = place; if (!p || el.hidden || fold) return;
    const [bw, bh] = bodySize(p), len = p.horiz ? bw : bh, live = new Set();
    if (len !== +marks.dataset.len) { marks.dataset.len = String(len); shown.clear(); }
    for (const r of st.rovs || []) {
      live.add(r.id);
      let m = markEls.get(r.id);
      if (!m) {
        m = doc.createElement('div'); m.dataset.rov = r.id;
        m.innerHTML = '<i></i><b></b>'; marks.appendChild(m); markEls.set(r.id, m);
      }
      m.className = (r.sel ? 'dg-mark' : 'dg-dot') + (gaugeU(r.depth) > 0.72 ? ' flip' : '');
      m.style.setProperty('--c', r.colour);
      const px = gaugeU(r.depth) * len, last = shown.get(r.id);
      if (last == null || Math.abs(last - px) > 0.5 || m.dataset.sel !== String(!!r.sel)) {
        shown.set(r.id, px); m.dataset.sel = String(!!r.sel);
        m.dataset.px = px.toFixed(2);
        m.style.transform = p.horiz ? `translateX(${px.toFixed(1)}px)` : `translateY(${px.toFixed(1)}px)`;
        m.querySelector('b').textContent = r.sel ? `ROV ${r.id} · ${fmtDepth(r.depth)}` : '';
      }
    }
    for (const [id, m] of markEls) if (!live.has(id)) { m.remove(); markEls.delete(id); shown.delete(id); }
  }
  function tick(dt) {
    t += dt;
    if (t < 0.25 && !dirty) return;
    t = 0;
    layout();
    if (el.hidden) return;
    const st = (o.state && o.state()) || { rovs: [], region: null };
    if (st.region !== cur) {
      cur = st.region; dirty = true;
      const B = GAUGE_BANDS.find(b => b.id === cur);
      now.textContent = B ? B.name : '';
      for (const b of bandsEl.children) { const on = b.dataset.region === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    }
    if (dirty) { dirty = false; draw(); }
    marksNow(st);
  }
  if (o.phoneQ && o.phoneQ.addEventListener) o.phoneQ.addEventListener('change', () => { key = ''; tick(1); });
  win.addEventListener('resize', () => { key = ''; t = 1; });
  return {
    el, tick, layout,
    get fold() { return fold; },
    debug() {
      return {
        place, fold, cur, hidden: el.hidden,
        bands: [...bandsEl.children].map(b => b.dataset.region),
        marks: [...markEls.values()].map(m => ({ id: +m.dataset.rov, px: +m.dataset.px, sel: m.classList.contains('dg-mark') })),
      };
    },
  };
}
export const fmtDepth = (d) => (d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : `${Math.round(d)} m`);
