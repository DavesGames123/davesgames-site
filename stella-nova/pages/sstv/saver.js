// ============================================================================
//  SSTV  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page, puts one full-window canvas on top and plays a seeded plan of
//  shots from plan.js, 6 to 12 s each, never the same kind twice in a row:
//    receive   the CRT receives a picture in one mode, waterfall beside it
//    closeup   a push-in that follows the beam down the lines, near 1x
//    vis       the VIS header decoded bit by bit, full width
//    slant     a noisy transmission with a clock error leans, then the
//              sync fit repaints it straight, line by line
//    iss       an ISS-style event card in a PD mode, with fading
//  Every picture goes through the real round trip (encode, channel,
//  decode). The saver plays no sound. The plate names the mode, the line
//  time and the frequency-to-brightness map. It carries no code.
//  The page loop in main.js stops while window.__sstvSaver is true.
//
//  grep -n targets
//    "function startShot"   one shot: session, speed, plate
//    "function frame"       the draw loop
//    "function layout"      CRT box and waterfall column in the clear band
// ============================================================================
import { planShots } from './plan.js';
import { byId } from './modes.js';
import { decodeAll } from './codec.js';
import { cardFor } from './images.js';
import { CRT, PHOSPHORS } from './crt.js';
import { Session } from './session.js';
import { Waterfall, PAL, roundRect } from './view.js';
import { VisScene } from './figures.js';
import { plateBand } from '../../lib/saver-clear.js';

const FS = 11025;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TEX = ['f = 1500 + \\frac{800\\,Y}{255}\\ \\text{Hz}'];
const RULES = [['Y', 'm5']];
const CREDIT = 'Encoder after pysstv (MIT), decoder our own · timings: Barber, Dayton 2000';

let run = null;

function layout(w, h, band) {
  const top = band ? band.t : 20, bot = band ? band.b : 20, bh = Math.max(160, h - top - bot);
  if (w / bh > 1.3) {
    const cw = Math.min(bh * 1.18, w * 0.64), ww = Math.min(300, w * 0.2), gap = Math.min(40, w * 0.03);
    const x0 = (w - cw - gap - ww) / 2;
    return { crt: { x: x0, y: top, w: cw, h: bh }, wf: { x: x0 + cw + gap, y: top + bh * 0.06, w: ww, h: bh * 0.84 }, top, bh };
  }
  const ch = Math.min(bh * 0.72, w * 0.98 / 1.0);
  return { crt: { x: (w - Math.min(w * 0.98, ch * 1.18)) / 2, y: top, w: Math.min(w * 0.98, ch * 1.18), h: ch }, wf: { x: w * 0.1, y: top + ch + 14, w: w * 0.8, h: bh - ch - 30 }, top, bh };
}

function startShot(S) {
  const r = run, m = byId(S.mode);
  r.S = S; r.k = 0; r.tau = 0; r.sess = null; r.vis = null; r.fixed = null; r.wipe = 0; r.cam = null;
  r.crt.setPhosphor(S.phosphor);
  r.wf.clear(); r.hop = 0;
  const lineTxt = `${m.lineMs.toFixed(3)} ms${m.rows === 2 ? ' per 2 rows' : ''}`;
  const ph = PHOSPHORS[S.phosphor], phName = S.phosphor === 'colour' ? 'a colour tube' : `a ${ph.name} tube`;
  let plate;
  if (S.kind === 'vis') {
    r.vis = new VisScene(); r.vis.set('mode', S.mode);
    plate = { title: 'The VIS header', sub: `seven bits, LSB first: ${m.vis} means ${m.name}`, tex: ['\\text{code} = \\sum_{i=0}^{6} b_i\\,2^i', TEX[0]], rules: [['b_i', 'm6'], ...RULES],
      params: [{ name: 'leader', value: '1900 Hz, 2 × 300 ms' }, { name: 'bits', value: '30 ms: 1100 Hz = 1, 1300 Hz = 0' }], lines: [CREDIT] };
  } else {
    const o = { mode: m, img: cardFor(S.card, m), crt: r.crt, fs: FS, seed: S.seed, snr: 32 };
    if (S.kind === 'slant') Object.assign(o, { clock: (S.seed % 2 ? 1 : -1) * 0.007, slant: false, snr: 19 });
    if (S.kind === 'iss') Object.assign(o, { snr: 22, fade: 0.4 });
    r.sess = new Session(o);
    const dur = r.sess.dur;
    if (S.kind === 'closeup') {
      r.speed = Math.max(1, 16 * m.lineMs / 1000 / S.dur);
      r.t = r.sess.imageStart() + m.lines * m.lineMs / 1000 * (0.3 + 0.25 * ((S.seed >>> 3) % 100) / 100);
      r.sess.advance(r.t, -100);
    } else {
      const frac = S.kind === 'slant' ? 0.5 : S.kind === 'iss' ? 0.86 : 0.84;
      r.speed = dur / (S.dur * frac); r.t = 0.2;
    }
    const base = { params: [{ name: 'mode', value: `${m.name}, ${m.W}×${m.H}` }, { name: 'line', value: lineTxt }, { name: 'speed', value: `${r.speed.toFixed(r.speed < 10 ? 1 : 0)}× real time` }], tex: TEX, rules: RULES, lines: [CREDIT] };
    if (S.kind === 'receive') plate = { ...base, title: `${m.name} on ${phName}`, sub: 'a picture that arrives as sound, one line at a time' };
    if (S.kind === 'closeup') plate = { ...base, title: 'The beam paints a line', sub: `${m.name} sends ${m.colour === 'GBR' ? 'green, blue, then red' : m.colour === 'YUV' ? 'luminance, then colour differences' : 'red, green, then blue'} in each line` };
    if (S.kind === 'slant') plate = { ...base, title: 'Slant, then the sync fit', sub: `the sender clock is ${o.clock > 0 ? '+' : ''}${(o.clock * 100).toFixed(1)} % off: the picture leans until the receiver fits the syncs`, tex: [TEX[0], 't_k = a + k\\,P'], rules: [...RULES, ['P', 'm2']] };
    if (S.kind === 'iss') plate = { ...base, title: 'An ISS-style SSTV event', sub: `${m.name} on 145.800 MHz FM, with fading`, lines: ['Our own event card, not an ARISS card', CREDIT] };
  }
  r.plate = plate; r.plated = false;
}

function frame(now) {
  const r = run; if (!r) return;
  const dt = Math.min(0.05, r.last ? (now - r.last) / 1000 : 0.016); r.last = now; r.T += dt; r.tau += dt;
  const cv = r.cv, dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const S = r.S;
  if (r.tau > S.dur) { r.i = (r.i + 1) % r.plan.length; startShot(r.plan[r.i]); }
  const g = r.g, band = typeof r.o.label === 'function' ? plateBand(h) : null, L = layout(w, h, band);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  let subj = null;
  try {
    if (r.vis) {
      r.vis.step(dt);
      const vw = 900, vh = r.vis.height(vw), sc = Math.min(L.bh / vh, w * 0.94 / vw);
      g.save(); g.translate((w - vw * sc) / 2, L.top + (L.bh - vh * sc) / 2); g.scale(sc, sc);
      r.vis.render(g, vw, vh); g.restore();
      subj = { x: w / 2, y: L.top + L.bh / 2, r: vw * sc * 0.4 };
    } else {
      const s = r.sess, m = s.m;
      if (!s.done) {
        r.t += dt * r.speed; s.advance(r.t, r.T);
        r.hop += dt * r.speed; let k = 0;
        while (r.hop > 0.03 && k++ < 6) { r.hop -= 0.03; r.wf.add(s.x, Math.round((r.t - r.hop) * FS)); }
        if (r.hop > 0.3) r.hop = 0;
      } else if (S.kind === 'slant') {
        if (!r.fixed) r.fixed = decodeAll(s.x, FS, { slant: true }).img;
        const n = Math.floor(r.wipe), next = Math.min(m.H, Math.floor(r.wipe + dt * m.H / (S.dur * 0.38)));
        const rows = []; for (let y = n; y < next; y++) rows.push(y);
        if (rows.length && r.fixed) r.crt.paintRows(r.fixed, rows, r.T);
        r.wipe = next;
      }
      const st = s.status(), beam = s.done ? (S.kind === 'slant' && r.wipe < m.H ? { row: r.wipe, x: 0.5 } : null) : (st.phase === 'image' ? s.beam() : null);
      const read = [m.name, S.kind === 'slant' && s.done ? (r.wipe < m.H ? 'sync fit…' : 'corrected') : st.phase === 'image' ? `line ${st.line}/${m.lines}` : st.phase === 'done' ? 'received' : 'VIS…'];
      const ro = { dpr, t: r.T, beam: beam && beam.x != null ? beam : null, snow: st.phase === 'vis' || st.phase === 'idle' ? 0.6 : 0, readout: read, led: !s.done };
      if (S.kind === 'closeup') {
        const B = L.crt, lay = r.crt.layout(B), Z = 2.3;
        const p = beam && beam.x != null ? r.crt.pointOnPage(beam.row, 0.5, lay) : (r.cam ? { x: r.cam.x, y: r.cam.y } : { x: B.x + B.w / 2, y: B.y + B.h / 2 });
        const tx = p.x + Math.sin(r.tau * 0.35) * lay.scr.w * 0.18, ty = p.y;
        if (!r.cam) r.cam = { x: tx, y: ty, vx: 0, vy: 0 };
        const c = r.cam, k = 6, d = 4.5;
        c.vx += ((tx - c.x) * k - c.vx * d) * dt; c.vy += ((ty - c.y) * k - c.vy * d) * dt; c.x += c.vx * dt; c.y += c.vy * dt;
        const zin = clamp(r.tau / 1.5, 0, 1), zz = 1 + (Z - 1) * zin * zin * (3 - 2 * zin);
        const cx = w / 2, cy = L.top + L.bh / 2;
        const box = { x: cx - (c.x - B.x) * zz, y: cy - (c.y - B.y) * zz, w: B.w * zz, h: B.h * zz };
        g.save(); g.beginPath(); g.rect(0, L.top - 6, w, L.bh + 12); g.clip();
        r.crt.render(g, { ...ro, box, dpr: Math.min(dpr, 1.25) });
        g.restore();
        subj = { x: cx, y: cy, r: Math.min(w, L.bh) * 0.25 };
      } else {
        r.crt.render(g, { ...ro, box: L.crt });
        const ly = r.crt.L;
        subj = { x: ly.scr.x + ly.scr.w / 2, y: ly.scr.y + ly.scr.h / 2, r: Math.min(ly.scr.w, ly.scr.h) * 0.5 };
        // waterfall column
        const W = L.wf;
        if (W.w > 60 && W.h > 60) {
          g.font = '400 11px Inter, system-ui, sans-serif'; g.fillStyle = PAL.dim; g.textAlign = 'left';
          g.fillText(`waterfall · ${r.speed.toFixed(r.speed < 10 ? 1 : 0)}×`, W.x, W.y - 8);
          const off = S.kind === 'iss' && W.w > 150 ? 112 : 0;
          r.wf.draw(g, W.x, W.y + off, W.w, W.h - 30 - off, { font: 10 });
        }
        if (S.kind === 'iss') eventCard(g, L, m, W);
      }
    }
  } catch (e) { /* skip a bad frame */ }
  // fade at the cut
  const f = clamp(Math.min(r.tau, S.dur - r.tau) / 0.5, 0, 1);
  if (f < 1) { g.fillStyle = `rgba(5,7,10,${1 - f})`; g.fillRect(0, 0, w, h); }
  r.subj = subj;
  if (!r.plated && typeof r.o.label === 'function') {
    r.plated = true;
    try { r.o.label({ ...r.plate, anchor: () => (run && run.subj ? { ...run.subj } : null) }); } catch (e) { /* the plate is optional */ }
  }
  r.raf = requestAnimationFrame(frame);
}

// A small card beside the CRT: frequency, mode, the ISS pass feel.
function eventCard(g, L, m, W) {
  const wide = W.w > 150, C = L.crt;
  const x = wide ? W.x : C.x + C.w * 0.04, y = wide ? W.y - 4 : C.y + C.h * 0.05, w = wide ? W.w : Math.min(230, C.w * 0.4), h = 96;
  g.save();
  roundRect(g, x, y, w, h, 10); g.fillStyle = 'rgba(6,10,16,0.82)'; g.fill(); g.strokeStyle = 'rgba(127,224,168,0.45)'; g.stroke();
  g.textAlign = 'left'; g.fillStyle = PAL.acc; g.font = '600 13px Inter, system-ui, sans-serif'; g.fillText('SSTV event', x + 12, y + 22);
  g.fillStyle = PAL.ink2; g.font = '400 12px Inter, system-ui, sans-serif';
  g.fillText('145.800 MHz FM downlink', x + 12, y + 42); g.fillText(`${m.name} · ${m.W}×${m.H}`, x + 12, y + 60);
  g.fillStyle = PAL.dim; g.fillText('a pass lasts about 10 minutes', x + 12, y + 78);
  g.restore();
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const seed = (o.seed >>> 0) || ((Math.random() * 1e9) | 0);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__sstvSaver = true;
    run = { o, css, cv, g: cv.getContext('2d'), crt: new CRT(), wf: new Waterfall(FS, { N: 512, rows: 260, cols: 180, f0: 1000, f1: 2500 }), plan: planShots(seed, 24), i: 0, T: 0, last: 0, raf: 0 };
    startShot(run.plan[0]);
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 800 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    run.cv.remove(); run.css.remove();
    if (typeof run.o.label === 'function') { try { run.o.label(null); } catch (e) { /* ok */ } }
    run = null; window.__sstvSaver = false;
  },
};
window.snSaver.debug = () => (run ? { kind: run.S.kind, mode: run.S.mode, tau: run.tau, dur: run.S.dur, line: run.sess ? run.sess.rx.k : null, wipe: run.wipe } : null);
window.snSaver.cut = (kind) => { if (!run) return; const j = run.plan.findIndex((p, i) => i > run.i && p.kind === kind); if (j >= 0) { run.i = j; startShot(run.plan[j]); } };
