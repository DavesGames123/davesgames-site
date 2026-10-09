// ============================================================================
//  OUTBREAK  ·  render/hud.js — the on-canvas HUD of the screensaver
// ----------------------------------------------------------------------------
//  The shell records only the canvas, and in the saver the page hides its
//  DOM HUD. So the saver draws its live numbers into the WebGL canvas: a
//  2D canvas at device px, uploaded as a texture and drawn 1:1 (nearest
//  filter, a quad snapped to whole device px) after the fade quad, so the
//  numbers stay crisp and stay on through a cut.
//
//  Rows: DAY and R_eff (with a red up or teal down mark), INFECTED NOW and
//  CASES TODAY in red, TOTAL CASES, DEATHS, REACHED (cities, countries),
//  and a sparkline of the daily new cases (log scale, red, peak tick).
//  A 'curve' shot (director.js) gives the sparkline a tall panel with the
//  peak day and size. Figures are tabular: each digit sits in a cell of
//  the width of '0', so a ticking counter does not shift. The counters
//  tick up (stats.js tickCounter). Phones get a compact two-column panel
//  and redraw at PHONE_HZ (desktop HZ).
//
//  Pure helpers (tests/hud.test.mjs, no DOM): hudSize, hudRect, hudRows,
//  sparkPoints, drawHud (draws through any object with the 2D context
//  calls; a test stub records the text).
//  createHud(ctx) -> { setOn(b), setRect(r), setFocus(f), update(t, data),
//  get on, dispose() } or null without a document or THREE.CanvasTexture.
//
//  grep -n targets: "export const HUD", "export function hudSize",
//                   "export function hudRect", "export function hudRows",
//                   "export function sparkPoints", "export function drawHud",
//                   "function drawTab", "export function createHud"
// ============================================================================
import { fmtCount } from '../ui.js';
import { tickCounter } from '../stats.js';
import { PAL, toHex } from './infect.js';

export const HUD = {
  w: 296, h: 178, hCurve: 262,           // CSS px, desktop
  phoneW: 320, phoneH: 112, phoneHCurve: 168,
  margin: 16, hz: 15, phoneHz: 10,
};
const RED = toHex(PAL.arterial), RED_INK = '#ff4a55', CORE = toHex(PAL.core);
const INK = '#e9ecf1', DIM = '#8a92a0', TEAL = '#6fb3ae';
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

// Panel size in CSS px. maxW: the room (the clear band width).
export function hudSize(phone, focus, maxW = Infinity) {
  const w = Math.max(200, Math.min(phone ? HUD.phoneW : HUD.w, maxW - 2 * (phone ? 12 : HUD.margin)));
  const h = focus === 'curve' ? (phone ? HUD.phoneHCurve : HUD.hCurve) : (phone ? HUD.phoneH : HUD.h);
  return { w, h };
}

// Where the panel goes, in CSS px: the bottom-left corner of the clear
// band (band = { l, r, t, b } edges from the top-left), or of the frame.
export function hudRect(band, W, H, phone, focus) {
  const B = band || { l: 0, r: W, t: 0, b: H };
  const s = hudSize(phone, focus, B.r - B.l), m = phone ? 12 : HUD.margin;
  const l = phone ? B.l + Math.round((B.r - B.l - s.w) / 2) : B.l + m;
  const t = Math.max(B.t + m, B.b - s.h - m);
  return { l: Math.round(l), t: Math.round(t), w: s.w, h: s.h };
}

// The text rows of the HUD from stats.js hud() values: [{ k, label, value, hot }]
export function hudRows(d) {
  d = d || {};
  const reff = Number.isFinite(d.reff) ? d.reff.toFixed(2) : '-';
  return [
    { k: 'day', label: 'DAY', value: String(Math.floor(d.day || 0)) },
    { k: 'reff', label: 'R EFF', value: reff, hot: Number.isFinite(d.reff) && d.reff > 1 },
    { k: 'infected', label: 'INFECTED NOW', value: fmtCount(d.infected), hot: true },
    { k: 'today', label: 'CASES TODAY', value: '+' + fmtCount(d.today), hot: true },
    { k: 'cases', label: 'TOTAL CASES', value: fmtCount(d.cases) },
    { k: 'deaths', label: 'DEATHS', value: fmtCount(d.deaths) },
    { k: 'reached', label: 'REACHED', value: `${d.cities || 0} cities · ${d.countries || 0} countries` },
  ];
}

// Daily new cases -> points in a w x h box (log scale, 1 .. max), the last
// `days` values. -> { pts: [[x, y]], peak: index, max }
export function sparkPoints(series, w, h, days = 360) {
  const s = series ? Array.from(series).slice(-days) : [];
  let max = 1, peak = -1;
  for (let i = 0; i < s.length; i++) if (s[i] > max) { max = s[i]; peak = i; }
  const ly = v => (v > 1 ? Math.log(v) / Math.log(max) : 0);
  const n = Math.max(2, s.length);
  const pts = s.map((v, i) => [i / (n - 1) * w, h - ly(v) * h]);
  return { pts, peak, max };
}

// Text with tabular figures: each digit in a cell of the width of '0'.
// Right-aligned at x. Returns the left edge.
function drawTab(g, str, x, y) {
  const dw = g.measureText('0').width;
  let px = x;
  for (let i = str.length - 1; i >= 0; i--) {
    const ch = str[i], cw = ch >= '0' && ch <= '9' ? dw : g.measureText(ch).width;
    px -= cw;
    g.fillText(ch, Math.round(px + (cw - g.measureText(ch).width) / 2), y);
  }
  return px;
}

// Draw the panel. g: a 2D context (or a stub). L = { w, h, pr, phone, focus }
// in CSS px; d = the shown values (hudRows input) plus series (daily new
// cases) and curve (stats.js curve()).
export function drawHud(g, d, L) {
  const pr = L.pr || 1, W = Math.round(L.w * pr), H = Math.round(L.h * pr), q = v => Math.round(v * pr);
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(4,5,9,0.74)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 0, W, Math.max(1, q(0.5))); g.fillRect(0, H - Math.max(1, q(0.5)), W, Math.max(1, q(0.5)));
  g.fillRect(W - Math.max(1, q(0.5)), 0, Math.max(1, q(0.5)), H);
  g.fillStyle = RED; g.fillRect(0, 0, q(2), H);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const rows = hudRows(d), R = Object.fromEntries(rows.map(r => [r.k, r]));
  const label = (txt, x, y) => { g.font = `600 ${q(L.phone ? 8.5 : 9)}px ${FONT}`; g.fillStyle = DIM; g.fillText(txt, x, y); };
  const value = (r, x, y, size) => { g.font = `600 ${q(size)}px ${FONT}`; g.fillStyle = r.hot ? RED_INK : INK; return drawTab(g, r.value, x, y); };
  const pad = q(L.phone ? 10 : 14), x0 = pad + q(2), x1 = W - pad;
  let y = pad + q(10), sparkTop, sparkH;
  if (!L.phone) {
    label('DAY', x0, y); value(R.day, x0 + q(64), y, 11);
    label('R EFF', x1 - q(96), y); value(R.reff, x1 - q(12), y, 11);
    g.fillStyle = R.reff.hot ? RED : TEAL; g.font = `600 ${q(8)}px ${FONT}`;
    g.fillText(R.reff.hot ? '▲' : '▼', x1 - q(8), y);
    y += q(24);
    label('INFECTED NOW', x0, y); value(R.infected, x1, y, 17);
    y += q(21);
    label('CASES TODAY', x0, y); value(R.today, x1, y, 15);
    y += q(19);
    label('TOTAL CASES', x0, y); value(R.cases, x1, y, 12.5);
    y += q(17);
    label('DEATHS', x0, y); value(R.deaths, x1, y, 12.5);
    y += q(17);
    label('REACHED', x0, y); value(R.reached, x1, y, 11);
    sparkTop = y + q(10); sparkH = H - sparkTop - pad;
  } else {
    // compact: two columns of three rows
    const cx = Math.round(W / 2) + q(4);
    const pair = (a, b, yy, size) => { label(a.label, x0, yy - q(12)); value(a, cx - q(10), yy, size); label(b.label, cx + q(4), yy - q(12)); value(b, x1, yy, size); };
    y = pad + q(20); pair(R.infected, R.today, y, 14);
    y += q(26); pair(R.deaths, R.reff, y, 12);
    y += q(16); label(`DAY ${R.day.value} · ${R.reached.value.toUpperCase()}`, x0, y);
    sparkTop = y + q(8); sparkH = H - sparkTop - pad;
  }
  // the curve: daily new cases, log scale
  if (sparkH > q(10)) {
    const sw = x1 - x0, sp = sparkPoints(d.series, sw, sparkH, L.focus === 'curve' ? 720 : 240);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x0, sparkTop, sw, sparkH);
    if (sp.pts.length > 1) {
      g.beginPath(); g.moveTo(x0 + sp.pts[0][0], sparkTop + sparkH);
      for (const [px, py] of sp.pts) g.lineTo(x0 + px, sparkTop + py);
      g.lineTo(x0 + sp.pts[sp.pts.length - 1][0], sparkTop + sparkH); g.closePath();
      g.fillStyle = 'rgba(160,0,18,0.45)'; g.fill();
      g.beginPath();
      sp.pts.forEach(([px, py], i) => (i ? g.lineTo(x0 + px, sparkTop + py) : g.moveTo(x0 + px, sparkTop + py)));
      g.strokeStyle = RED; g.lineWidth = Math.max(1, q(1.5)); g.stroke();
      const last = sp.pts[sp.pts.length - 1];
      g.fillStyle = CORE; g.fillRect(Math.round(x0 + last[0] - q(2)), Math.round(sparkTop + last[1] - q(2)), q(4), q(4));
      if (sp.peak >= 0 && L.focus === 'curve') {
        const pk = sp.pts[sp.peak];
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(Math.round(x0 + pk[0]), sparkTop, Math.max(1, q(1)), sparkH);
        const c = d.curve || {};
        label(`PEAK DAY ${Math.floor(c.peakDay || 0)} · ${fmtCount(sp.max)} A DAY`, x0 + q(4), sparkTop + q(11));
      }
    }
    label(L.focus === 'curve' ? 'NEW CASES A DAY · LOG SCALE' : 'NEW CASES A DAY', x0 + q(4), sparkTop + sparkH - q(4));
  }
  return rows;
}

const HUD_VERT = /* glsl */`
uniform vec4 uRect;
uniform vec2 uRes;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec2 p = vec2(uRect.x + (position.x + 0.5) * uRect.z, uRect.y + (0.5 - position.y) * uRect.w);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const HUD_FRAG = /* glsl */`
uniform sampler2D uTex;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;
export const SHADERS = { hud: [HUD_VERT, HUD_FRAG] };

export function createHud(ctx) {
  const { THREE, renderer, scene } = ctx;
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !THREE || !THREE.CanvasTexture || !scene) return null;
  const cv = doc.createElement('canvas'), g = cv.getContext('2d');
  if (!g) return null;
  const phone = !!ctx.phone, hz = phone ? HUD.phoneHz : HUD.hz;
  let tex = null, on = false, rect = null, focus = null, drawnAt = -1e9, tickAt = null;
  const shown = { infected: 0, today: 0, cases: 0, deaths: 0 };
  const U = { uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uRes: { value: new THREE.Vector2(1, 1) }, uTex: { value: null } };
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: HUD_VERT, fragmentShader: HUD_FRAG, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 1e6 + 1; mesh.visible = false; mesh.name = 'saver-hud';
  scene.add(mesh);

  function fit() {
    if (!rect) return false;
    const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    const el = renderer.domElement, s = hudSize(phone, focus, Infinity);
    const w = Math.round(rect.w * pr), h = Math.round(s.h * pr);
    if (cv.width !== w || cv.height !== h || !tex) {
      cv.width = w; cv.height = h;
      if (tex) tex.dispose();
      tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.premultiplyAlpha = true;
      U.uTex.value = tex;
    }
    const top = rect.t + (rect.h - s.h);
    U.uRect.value.set(Math.round(rect.l * pr), Math.round(top * pr), w, h);
    if (el && el.width) U.uRes.value.set(el.width, el.height);
    return true;
  }

  return {
    get on() { return on; },
    mesh,
    setOn(b) { on = !!b; mesh.visible = on && !!rect; if (!on) { tickAt = null; for (const k in shown) shown[k] = 0; } },
    setRect(r) { rect = r ? { ...r } : null; mesh.visible = on && !!rect; drawnAt = -1e9; },
    setFocus(f) { if (f !== focus) { focus = f || null; drawnAt = -1e9; } },
    update(t, data) {
      if (!on || !rect || !data) return;
      const dt = tickAt === null ? 1 : Math.max(0, t - tickAt);
      if (t - drawnAt < 1 / hz && t >= drawnAt) return;
      tickAt = t; drawnAt = t;
      for (const k of Object.keys(shown)) shown[k] = tickCounter(shown[k], data[k] || 0, dt);
      if (!fit()) return;
      const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      drawHud(g, { ...data, ...shown }, { w: rect.w, h: hudSize(phone, focus).h, pr, phone, focus });
      tex.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose(); mat.dispose(); if (tex) tex.dispose();
    },
  };
}
