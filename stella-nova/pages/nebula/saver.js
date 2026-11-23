// ============================================================================
//  NEBULA  ·  saver.js — window.snSaver for the shell screensaver
// ----------------------------------------------------------------------------
//  installSaver(api) defines window.snSaver (protocol: lib/screensaver.js).
//  enter(opts) hides the page GUI (html.saving) and plays shots from
//  makePlan(): a seeded shuffle of the nebula's own landmarks (the hub, the
//  pillars, the ionization front, the Wolf-Rayet bubble, the jets, ...), read
//  from the composition of the look on screen, so a new nebula gives new
//  places to visit.
//
//  Shot kinds (each 5-12 s, longer when calm):
//    glide  a slow pan past the landmark, a small push-in
//    push   the view holds, the frame pushes in on the landmark (the at-rest
//           mean converges, so this is the sharpest shot)
//    pull   the reverse: from close on the landmark out to the full height
//    sweep  a long traverse of one region of the strip
//  A cut is a fade through black. Every LOOK_EVERY shots the colours change
//  (the pre-light rerun) and every NEBULA_EVERY shots a new nebula grows (a
//  full bake). While a look bakes, the last frame holds and keeps drifting,
//  and the new look crossfades in.
//
//  Output: the saver draws its own 2D canvas (#saverCanvas) from the GL
//  frame copy that main.js makes after each draw (api.snap). So the fades,
//  the push-ins and the held frame are in the recording, and the canvas is
//  in the document (a detached canvas records black in Safari).
//  Framing: plateBand() (lib/saver-clear.js) gives the clear band between
//  the plate's top and bottom text. The crop puts the landmark at the band
//  centre, for 16:9 and 9:16 alike.
//
//  grep -n targets: "export function makePlan", "export function landmarks",
//    "export function cropFor", "enter(opts)", "function frame", "debug()"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { CONTENT_W, clampView } from './engine/params.js';

export const LOOK_EVERY = 3, NEBULA_EVERY = 7;

// PCG-ish small RNG (mulberry32): the saver needs no stream compatibility.
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  hub: ['Filament hub', 'hub'], core1: ['Dense core', 'hub'], pil: ['Pillars', 'front'], g1: ['Cometary globule', 'front'],
  cliff: ['Ionization front', 'front'], wr: ['Wolf-Rayet bubble', 'wind'], rn: ['Reflection nebula', 'light'],
  hh901: ['Herbig-Haro jet', 'jet'], hh902: ['Herbig-Haro jet', 'jet'], hubjet: ['Protostellar jet', 'jet'],
  b0L: ['Embedded hot star', 'light'], b0R: ['Embedded hot star', 'light'], ro: ['Runaway star', 'light'],
  cl1: ['Ionizing cluster', 'front'],
};
// landmarks(comp) -> [{ id, name, topic, x, y, p }] in content px (y up, 0..1080), p = parallax.
export function landmarks(c) {
  const out = [];
  const add = (id, key, a) => {
    if (!a || !Number.isFinite(a[0])) return;
    const [name, topic] = NAMES[key];
    out.push({ id, name, topic, x: a[0], y: Math.min(1000, Math.max(80, a[1])), p: a[2] > 0.5 && a[2] < 1.3 ? a[2] : 1 });
  };
  for (const f of c.features || []) {
    if (f.id === 'hub' || f.id === 'core1' || f.id === 'g1') add(f.id, f.id, f.a);
    else if (/^pil\d$/.test(f.id)) add(f.id, 'pil', f.a);
    else if (f.id === 'cliff' && f.x) add('cliff', 'cliff', [(f.x[0] + f.x[1]) / 2, (c.envelope && c.envelope.yTop ? c.envelope.yTop[0] : 430), 0.95]);
  }
  for (const s of c.sources || []) if (NAMES[s.id] && s.id !== 'hub') add(s.id, s.id, s.pos);
  // one pillar entry is enough for the pick; keep the middle one
  const pils = out.filter((l) => l.topic === 'front' && l.name === 'Pillars');
  if (pils.length > 1) { const keep = pils[Math.floor(pils.length / 2)]; return out.filter((l) => l.name !== 'Pillars' || l === keep); }
  return out;
}

const KINDS = ['glide', 'push', 'pull', 'sweep', 'push', 'glide'];
// makePlan(seed, calm) -> { next(comp) -> shot }
// shot = { n, kind, lm (landmark), dur, x0, x1 (content x of the view centre), z0, z1 (crop zoom), look: null | 'colours' | 'nebula' }
export function makePlan(seed, calm = 0.7) {
  const r = rng32(seed || 1);
  let n = 0, bag = [], lastId = null;
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  return {
    next(c) {
      n++;
      const lms = landmarks(c);
      if (!bag.length) { bag = lms.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
      let lm = bag.pop() || { id: 'mid', name: 'The cloud', topic: 'turb', x: CONTENT_W / 2, y: 540, p: 1 };
      if (lm.id === lastId && bag.length) lm = bag.pop();
      lastId = lm.id;
      const kind = n === 1 ? 'push' : pick(KINDS);
      const dur = (5 + 7 * r()) * (0.8 + 0.5 * calm);
      const dir = r() < 0.5 ? -1 : 1;
      let x0 = lm.x, x1 = lm.x, z0 = 1.05, z1 = 1.05;
      if (kind === 'glide') { const d = 260 + 220 * (1 - calm); x0 = lm.x - dir * d; x1 = lm.x + dir * d * 0.4; z0 = 1.05; z1 = 1.22; }
      else if (kind === 'push') { z0 = 1.04; z1 = 1.38 + 0.15 * r(); }
      else if (kind === 'pull') { z0 = 1.45 + 0.1 * r(); z1 = 1.04; }
      else if (kind === 'sweep') { const d = 700 + 500 * r(); x0 = lm.x - dir * d / 2; x1 = lm.x + dir * d / 2; z0 = z1 = 1.12; lm = { ...lm, name: 'Across the cloud', topic: 'turb' }; }
      const look = n > 1 && n % NEBULA_EVERY === 0 ? 'nebula' : n > 1 && n % LOOK_EVERY === 0 ? 'colours' : null;
      return { n, kind, lm, dur, x0, x1, z0, z1, look };
    },
  };
}

// The view centre at content x for parallax p: s such that screen x = viewW / 2 (params.js worldX).
export function scrollFor(x, p, viewW) {
  const S = CONTENT_W - clampView(viewW);
  const s = 0.5 * S + (x - 0.5 * S - viewW / 2) / (p || 1);
  return Math.min(1, Math.max(0, s / Math.max(1, S)));
}
// The landmark on screen (canvas units) at scroll s.
export function screenX(x, p, s, viewW) {
  const S = CONTENT_W - clampView(viewW);
  return x - 0.5 * S - (p || 1) * (s - 0.5 * S);
}

// cropFor(src, out, subj, zoom, band) -> [sx, sy, sw, sh]: the source rectangle that fills the
// output at this zoom and puts the subject (source px) at the centre of the clear band.
// band = { cy, h } in output px (cy from the top). The crop never leaves the source.
export function cropFor(src, out, subj, zoom, band) {
  const so = Math.max(src.w / out.w, src.h / out.h);   // cover
  const sw = out.w * so / zoom, sh = out.h * so / zoom;
  const fx = 0.5, fy = band ? band.cy / out.h : 0.5;
  const sx = Math.min(src.w - sw, Math.max(0, subj.x - fx * sw));
  const sy = Math.min(src.h - sh, Math.max(0, subj.y - fy * sh));
  return [sx, sy, sw, sh];
}

const ease = (t) => t * t * (3 - 2 * t);
const TEX = {
  front: 'R_S = \\left(\\frac{3\\,Q_0}{4\\pi\\, n_H^{2}\\, \\alpha_B}\\right)^{1/3}',
  hub: 't_{ff} = \\sqrt{\\frac{3\\pi}{32\\, G \\rho}}',
  turb: 'd\\hat{\\mathbf f}_k = -\\frac{\\hat{\\mathbf f}_k}{T}\\,dt + \\sqrt{\\frac{2}{T}}\\;\\mathsf P_\\zeta\\, d\\mathbf W',
  wind: 'R(t) = 0.76 \\left(\\frac{L_w\\, t^{3}}{\\rho_0}\\right)^{1/5}',
  jet: '\\Delta x_{\\text{knot}} = v_{\\text{jet}}\\, P',
  light: '\\frac{dI_\\nu}{ds} = j_\\nu - \\kappa_\\nu I_\\nu',
};
const EQ = {
  front: 'R_S = (3 Q0 / (4π nH² αB))^(1/3)', hub: 't_ff = √(3π / (32 G ρ))',
  turb: 'df_k = −f_k/T dt + √(2/T) P_ζ dW', wind: 'R(t) = 0.76 (L_w t³ / ρ0)^(1/5)',
  jet: 'Δx_knot = v_jet P', light: 'dI/ds = j − κ I',
};
const RULES = [['Q_0', 'm1'], ['\\alpha_B', 'm2'], ['\\rho', 'm3'], ['\\zeta', 'm4'], ['T', 'm5'], ['L_w', 'm1'], ['P', 'm2'], ['\\kappa_\\nu', 'm3']];
const REGION = (c, x) => { const r = (c.regions || []).find((g) => x >= g.x[0] && x < g.x[1]); return r ? r.label : 'the cloud'; };

export function installSaver(api) {
  let run = null;
  const cv = document.getElementById('saverCanvas');
  window.snSaver = {
    enter(opts = {}) {
      if (run) run.stop();
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      const label = typeof opts.label === 'function' ? opts.label : null;
      const plan = makePlan((opts.seed >>> 0) || ((Math.random() * 1e9) >>> 0), calm);
      const saved = { anim: api.animating(), t: api.scroller.getT() };
      document.documentElement.classList.add('saving');
      cv.hidden = false;
      api.setSnap(true); api.setAnimate(true); api.setSaverMotion(true);
      const g = cv.getContext('2d', { alpha: false });
      const prev = document.createElement('canvas'); let pg = null;
      let shot = null, t0 = 0, alive = true, raf = 0, band = null, bandAt = -1e9, fr = null;
      let hold = null;   // { since, done } while a look bakes: the old frame stays on screen
      let xfade = 0;     // time the new look started to show (crossfade from prev)

      function frameBand(H) {
        const now = performance.now();
        if (now - bandAt > 250) { bandAt = now; const b = plateBand(innerHeight); if (b || !label) band = b; }
        const k = H / innerHeight;
        if (!band) return { cy: H / 2, h: H };
        let t = band.t, b = band.b; const q = (t + b) / (0.68 * innerHeight); if (q > 1) { t /= q; b /= q; }
        return { cy: k * (t + (innerHeight - t - b) / 2), h: k * (innerHeight - t - b) };
      }
      function send() {
        if (!label || !shot) return;
        const c = api.comp(), f = c.forcing || {};
        const topic = shot.lm.topic;
        label({
          title: shot.lm.name,
          sub: `${REGION(c, shot.lm.x)} · ${api.palName(api.palette())} palette`,
          params: [
            { sym: '\\mathcal M', name: 'turbulent Mach', value: f.mach != null ? String(f.mach) : '—', cls: 'm1' },
            { sym: '\\zeta', name: 'solenoidal share', value: f.zeta != null ? String(f.zeta) : '—', cls: 'm4' },
            { sym: 'λ', name: 'forcing scale', value: f.lambdaPx ? `${f.lambdaPx[0]}–${f.lambdaPx[1]} px` : '—', cls: 'm5' },
            { sym: 'seed', name: 'nebula', value: api.look.code().look || 'original', cls: 'm2' },
          ],
          tex: [TEX[topic] || TEX.light], rules: RULES, eq: [EQ[topic] || EQ.light],
        });
      }
      function startShot() {
        shot = plan.next(api.comp());
        t0 = performance.now();
        const vw = api.viewW();
        api.scroller.jump(scrollFor(shot.x0, shot.lm.p, vw));
        if (shot.look && !api.busy()) {
          // copy the frame now on screen; it holds while the look bakes
          prev.width = cv.width; prev.height = cv.height; pg = prev.getContext('2d', { alpha: false });
          pg.drawImage(cv, 0, 0);
          hold = { since: performance.now() };
          const c = shot.look === 'nebula' ? api.look.shuffleAll() : api.look.shufflePalette();
          api.apply(c, shot.look === 'nebula' ? 'Growing a new nebula' : 'Relighting').then(() => {
            if (!alive) return;
            hold = null; xfade = performance.now();
            shot = plan.next(api.comp()); t0 = performance.now();
            api.scroller.jump(scrollFor(shot.x0, shot.lm.p, api.viewW()));
            send();
          });
        }
        send();
      }
      function frame(now) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        const dpr = Math.min(2, devicePixelRatio || 1);
        const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
        const f = frameBand(H);
        fr = fr ? { cy: fr.cy + (f.cy - fr.cy) * 0.08, h: fr.h + (f.h - fr.h) * 0.08 } : f;
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        if (hold) {
          // the last frame, dimmed a little, drifting in slowly while the look bakes
          const k = 1 + 0.02 * ((now - hold.since) / 1000);
          const sw = W / k, sh = H / k;
          g.globalAlpha = 0.75; g.drawImage(prev, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, W, H); g.globalAlpha = 1;
          return;
        }
        if (!shot) return;
        const el = (now - t0) / 1000, p = Math.min(1, el / shot.dur), e = ease(p);
        if (el >= shot.dur) { startShot(); return; }
        const vw = api.viewW();
        const x = shot.x0 + (shot.x1 - shot.x0) * e;
        if (shot.x0 !== shot.x1) api.scroller.jump(scrollFor(x, shot.lm.p, vw));
        const src = api.snap();
        if (!src.width) return;
        const s = api.scroller.get();
        const sxp = screenX(shot.lm.x, shot.lm.p, s, vw) / vw * src.width;
        const syp = (1 - shot.lm.y / 1080) * src.height;
        const zoom = shot.z0 + (shot.z1 - shot.z0) * e;
        const [cx, cy, cw, ch] = cropFor({ w: src.width, h: src.height }, { w: W, h: H }, { x: sxp, y: syp }, zoom, fr);
        const fade = Math.min(1, el / 0.9, Math.max(0, (shot.dur - el) / 0.8));
        const xf = xfade ? Math.min(1, (now - xfade) / 1400) : 1;
        if (xf < 1 && pg) { g.globalAlpha = 1 - xf; g.drawImage(prev, 0, 0, W, H); }
        g.globalAlpha = (xf < 1 ? xf : 1) * (xfade && xf < 1 ? 1 : fade);
        g.drawImage(src, cx, cy, cw, ch, 0, 0, W, H);
        g.globalAlpha = 1;
        if (xf >= 1) xfade = 0;
        api.kick();
      }
      run = {
        stop() {
          alive = false; cancelAnimationFrame(raf);
        },
      };
      startShot();
      raf = requestAnimationFrame(frame);
      this.debug = () => ({ shot, hold: !!hold, band, fr, el: shot ? +((performance.now() - t0) / 1000).toFixed(1) : 0 });
      this.cut = () => { if (!hold) startShot(); };
      run.saved = saved;
      return { canvas: cv, warmupMs: 2500 };
    },
    exit() {
      if (!run) return;
      run.stop();
      document.documentElement.classList.remove('saving');
      cv.hidden = true;
      api.setSnap(false); api.setSaverMotion(false); api.setAnimate(run.saved.anim);
      api.scroller.jump(run.saved.t);
      api.kick();
      run = null;
    },
  };
}
