// ============================================================================
//  BLACK OCTOBER  ·  saver.js — the screensaver hook
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js) when it runs in a
//  page. In node it only exports the pure shot logic for tests.mjs.
//
//  enter() hides the page, puts one full-window canvas on top and replays
//  the growth from the first event to the last (the replay length grows
//  with calm), holds the full record for a while, then starts again. Every
//  5 to 12 s it cuts to a new shot from a seeded plan (shotPlan). Each shot
//  aims at real data in the replay at the cut: the newest event, the
//  largest thread so far, a disputed event, a related link between two
//  threads, or the whole disc. A shot is a calm push-in with a small drift,
//  framed in the clear band between the shell plate texts
//  (lib/saver-clear.js plateBand), at 16:9 and at 9:16. The plate holds
//  plain text from the records only: no code and no equations.
//  The page loop in main.js stops while window.__boSaver is true.
//
//  grep -n targets
//    shot plan ............. "export function shotPlan"
//    shot subject .......... "export function shotTarget"
//    shot camera ........... "export function shotView"
//    replay timing ......... "export function growthAt"
//    plate text ............ "export function plateFor"
//    the hook .............. "function install"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';
import { relatedPairs, fmtUTC, threadName, CONF_TEXT, LAYOUT_OPTS, threadColors } from './model.js';

export const SHOT_KINDS = Object.freeze(['newest', 'thread', 'disputed', 'link', 'wide']);

// A seeded plan of n shots: each pass is a shuffle of all kinds, no kind
// twice in a row, 5 to 12 s each (calm 1 gives longer shots).
export function shotPlan(seed, n, calm = 0.7) {
  const R = rng((seed >>> 0) + 131), out = [];
  while (out.length < n) {
    const pass = SHOT_KINDS.slice();
    for (let k = pass.length - 1; k > 0; k--) { const m = Math.floor(R() * (k + 1)); [pass[k], pass[m]] = [pass[m], pass[k]]; }
    if (out.length && pass[0] === out[out.length - 1].kind) [pass[0], pass[1]] = [pass[1], pass[0]];
    for (const kind of pass) out.push({ kind, sec: Math.min(12, Math.max(5, 5 + 7 * (0.35 * calm + 0.65 * R()))) });
  }
  return out.slice(0, n);
}

// The world circle a shot aims at, from the first k nodes. It returns
// { kind, cx, cy, R, ids, focus } or null when the kind has no subject yet
// (for example no disputed event is shown). R is the radius to show.
export function shotTarget(L, k, kind, rand = Math.random) {
  const shown = L.nodes.slice(0, k);
  if (!shown.length) return null;
  const around = (n, m = 7) => {
    const d = shown.map(q => Math.hypot(q.x - n.x, q.y - n.y)).sort((a, b) => a - b);
    return Math.min(0.5, Math.max(0.09, (d[Math.min(m, d.length - 1)] || 0) * 1.3));
  };
  if (kind === 'wide') return { kind, cx: 0, cy: 0, R: 1.12, ids: [], focus: null };
  if (kind === 'newest') {
    const n = shown[shown.length - 1];
    return { kind, cx: n.x, cy: n.y, R: around(n), ids: [n.id], focus: n.id };
  }
  if (kind === 'disputed') {
    const d = shown.filter(n => n.ev.confidence === 'disputed');
    if (!d.length) return null;
    const n = d[Math.floor(rand() * d.length)];
    return { kind, cx: n.x, cy: n.y, R: around(n), ids: [n.id], focus: n.id };
  }
  if (kind === 'thread') {
    const by = new Map();
    for (const n of shown) by.set(n.thread, (by.get(n.thread) || 0) + 1);
    let best = null;
    for (const [th, c] of by) if (!best || c > best[1]) best = [th, c];
    const ns = shown.filter(n => n.thread === best[0]);
    const cx = ns.reduce((a, n) => a + n.x, 0) / ns.length, cy = ns.reduce((a, n) => a + n.y, 0) / ns.length;
    const R = Math.min(1.12, Math.max(0.12, Math.max(...ns.map(n => Math.hypot(n.x - cx, n.y - cy))) * 1.12));
    const root = ns.find(n => !n.parent) || ns[0];
    return { kind, cx, cy, R, ids: ns.map(n => n.id), focus: root.id, thread: best[0] };
  }
  if (kind === 'link') {
    const set = new Set(shown.map(n => n.id));
    const pairs = relatedPairs(L).filter(([a, b]) => set.has(a) && set.has(b));
    if (!pairs.length) return null;
    const [a, b] = pairs[Math.floor(rand() * pairs.length)].map(id => L.byId.get(id));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    return { kind, cx, cy, R: Math.min(1.12, Math.max(0.12, Math.hypot(a.x - b.x, a.y - b.y) / 2 * 1.35)), ids: [a.id, b.id], focus: b.id };
  }
  return null;
}

// The target of a cut. A kind with no subject yet falls back to 'newest',
// then to 'wide'.
export function pickTarget(L, k, kind, rand = Math.random) {
  return shotTarget(L, k, kind, rand) || shotTarget(L, k, 'newest', rand) || { kind: 'wide', cx: 0, cy: 0, R: 1.12, ids: [], focus: null };
}

// The view at u (0..1) through a shot, in a w x h canvas whose clear band
// is band.t from the top to band.b from the bottom. The target circle
// spans FILL of the short side of the band at u = 0, and PUSH times that
// at u = 1 (a slow push-in). The centre drifts by DRIFT of R along the
// angle drift (seeded per shot) and comes to rest on the target at u = 1.
export const FILL = 0.82, PUSH = 1.1, DRIFT = 0.06;
export function shotView(T, w, h, band, u, drift = 0) {
  const bh = Math.max(1, h - band.t - band.b), e = u * u * (3 - 2 * u);
  const s = Math.min(w, bh) * FILL / 2 / T.R * (1 + (PUSH - 1) * e), off = DRIFT * T.R * (1 - e);
  return { cx: T.cx + Math.cos(drift) * off, cy: T.cy + Math.sin(drift) * off, s, ox: w / 2, oy: band.t + bh / 2 };
}

// Replay timing. steps[i] is the weight of event i: a long step in radius
// gets a long step in time, as on the page. growthAt(steps, x) gives the
// shown count k and the frac of the next edge at x (0..1 of the replay).
export function growthSteps(L) {
  return L.nodes.map((n, i) => i ? Math.min(0.9, Math.max(0.12, 0.12 + 2.6 * (n.r - L.nodes[i - 1].r))) : 0.3);
}
export function growthAt(steps, x) {
  // The end is exact: the subtraction below can leave a rounding remainder
  // inside the last step (seen with 401 events: frac 0.99999999999853).
  if (x >= 1) return { k: steps.length, frac: 1 };
  const total = steps.reduce((a, b) => a + b, 0);
  let t = Math.min(1, Math.max(0, x)) * total;
  for (let i = 0; i < steps.length; i++) {
    if (t < steps[i]) return { k: i + 1, frac: t / steps[i] };
    t -= steps[i];
  }
  return { k: steps.length, frac: 1 };
}

// The label plate of a shot: plain text from the records, no code.
export function plateFor(L, T, k) {
  const N = L.nodes.length, n = T.focus ? L.byId.get(T.focus) : null, cut = (s, m = 80) => s.length > m ? s.slice(0, m - 1) + '…' : s;
  if (T.kind === 'wide' || !n) {
    const last = L.nodes[Math.max(0, k - 1)];
    return { title: 'Black October', sub: `${k} of ${N} events, to ${fmtUTC(last.t, last.ev.tPrecision)}`, lines: ['Distance from the centre is time; each wedge is one incident'] };
  }
  if (T.kind === 'thread') {
    const ns = T.ids.map(id => L.byId.get(id)), a = ns[0], b = ns[ns.length - 1];
    return { title: threadName(T.thread), sub: `${ns.length} events so far, the largest thread on screen`, lines: [`${fmtUTC(a.t, 'day')} to ${fmtUTC(b.t, 'day')}`] };
  }
  if (T.kind === 'link') {
    const [a, b] = T.ids.map(id => L.byId.get(id));
    return { title: 'A link between two threads', sub: `${threadName(a.thread)} and ${threadName(b.thread)}`, lines: [cut(a.ev.title), cut(b.ev.title)] };
  }
  const e = n.ev, lines = [`${fmtUTC(n.t, e.tPrecision)} · ${threadName(n.thread)}`];
  if (T.kind === 'disputed') return { title: cut(e.title, 90), sub: `Disputed: ${CONF_TEXT.disputed}`, lines };
  lines.push(`${e.confidence}, ${e.sources.length === 1 ? '1 source' : e.sources.length + ' sources'}`);
  return { title: cut(e.title, 90), sub: 'The newest event in the replay', lines };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function install() {
  const [{ EVENTS }, { layout }, { drawScene, PAL }, { plateBand }] = await Promise.all([
    import('./data/events.js'), import('./grow.js'), import('./render.js'), import('../../lib/saver-clear.js')]);
  const L = layout(EVENTS, LAYOUT_OPTS), N = L.nodes.length, COLORS = threadColors(L.threads);
  const INDEX = new Map(L.nodes.map((n, i) => [n.id, i])), STEPS = growthSteps(L);
  let run = null;
  window.snSaver = {
    enter(o = {}) {
      if (run) this.exit();
      const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
      const seed = (o.seed >>> 0) || 1, R = rng(seed + 977);
      const plan = shotPlan(seed, 96, calm);
      const grow = 75 + 60 * calm, hold = 35 + 25 * calm;
      const css = document.createElement('style');
      css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
        '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
      document.head.appendChild(css);
      const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
      document.body.appendChild(cv);
      window.__boSaver = true;
      const g = cv.getContext('2d');
      run = { css, cv, raf: 0, i: -1, tau: 0, clock: 0, last: 0, T: null, drift: 0, plated: -1 };
      const cut = k => {
        run.i++; run.tau = 0;
        run.T = pickTarget(L, Math.max(1, k), plan[run.i % plan.length].kind, R);
        run.drift = R() * Math.PI * 2;
      };
      const frame = now => {
        if (!run) return;
        const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        run.clock = (run.clock + dt) % (grow + hold);
        const G = growthAt(STEPS, run.clock / grow);
        run.tau += dt;
        if (!run.T || run.tau >= plan[run.i % plan.length].sec) cut(G.k);
        const shot = plan[run.i % plan.length], u = clamp(run.tau / shot.sec, 0, 1);
        const pb = typeof o.label === 'function' ? plateBand(h) : null, band = pb ? { t: pb.t, b: pb.b } : { t: 0, b: 0 };
        const view = shotView(run.T, w, h, band, u, run.drift), fit = Math.min(w, h - band.t - band.b) / 2 / 1.14;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        try {
          drawScene(g, L, { w, h, view, zoom: Math.max(1, view.s / fit), k: G.k, frac: G.frac, colors: COLORS,
            hidden: new Set(), confOff: new Set(), hover: null, sel: run.T.focus, front: G.k < N ? L.nodes[G.k - 1].t : null,
            labels: pb ? 'none' : new Set(run.T.ids.slice(0, 12)), font: Math.round(clamp(Math.min(w, h) / 80, 11, 16)),
            names: threadName, index: INDEX });
        } catch (e) { /* a bad frame is skipped */ }
        const f = Math.min(run.tau, shot.sec - run.tau) / (0.6 + 0.6 * calm);
        if (f < 1) { g.globalAlpha = 1 - clamp(f, 0, 1) ** 2 * (3 - 2 * clamp(f, 0, 1)); g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h); g.globalAlpha = 1; }
        if (run.plated !== run.i && typeof o.label === 'function') {
          run.plated = run.i;
          const T = run.T;
          try {
            o.label(Object.assign(plateFor(L, T, G.k), { anchor: () => {
              if (!run) return null;
              const v = shotView(run.T, innerWidth, innerHeight, band, clamp(run.tau / shot.sec, 0, 1), run.drift);
              return { x: (T.cx - v.cx) * v.s + v.ox, y: (T.cy - v.cy) * v.s + v.oy, r: T.R * v.s };
            } }));
          } catch (e) { /* the plate is optional */ }
        }
        run.raf = requestAnimationFrame(frame);
      };
      run.raf = requestAnimationFrame(frame);
      return { canvas: cv, warmupMs: 600 };
    },
    exit() {
      if (!run) return;
      cancelAnimationFrame(run.raf);
      run.cv.remove(); run.css.remove();
      run = null; window.__boSaver = false;
      if (window.__bo) window.__bo.request();
    },
  };
  // The shot on screen, for a probe.
  window.snSaver.debug = () => run ? { i: run.i, kind: run.T && run.T.kind, focus: run.T && run.T.focus, tau: run.tau, clock: run.clock } : null;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') install();
