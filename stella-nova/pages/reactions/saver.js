// ============================================================================
//  REACTIONS  ·  saver.js  ·  window.snSaver, the screensaver tour
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the GUI (html.sn-saver) and
//  tours famous syntheses in a seeded shuffle (a new order each run):
//    tree   the synthesis tree grows step by step (fishdraw layout, a
//           seeded choice of tree, radial or fan), framed in the clear
//           band of the label plate, then pushes in on the target
//    step   one step in 3D: the reactants draw as skeletal formulas and
//           lift into 3D, come in, push together, bonds snap and form, the
//           by-products drift apart labelled, the product turns
//  Each shot is 5-12 s (calm makes the tree shots longer; a step shot is
//  the length of its animation). A cut fades through black. The plate
//  carries the reaction in TeX (mhchem), the conditions and a short
//  description; no code (no code extract on this page's plate).
//  The canvas that enter() returns is the 3D view, so a canvas-only
//  recording holds the step shots; the tree shots are DOM (cards and SVG).
//
//  snSaver.debug() returns the director state.
//  grep -n targets: "const SYNTHS", "const frameBand", "const plate"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { NAMED, CLASS } from './templates.js';
import { fromNamed, layout } from './synth.js';
import { makeScene } from './rxanim.js';

const SYNTHS = ['aspirin', 'paracetamol', 'soap', 'nylon', 'diels', 'grignard', 'ester', 'styrene', 'haber', 'fermentation'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function installSaver(api) {
  let run = null;
  const built = new Map();
  const synthOf = id => { if (!built.has(id)) built.set(id, fromNamed(api.S.OCL, NAMED.find(n => n.id === id))); return built.get(id); };
  window.snSaver = {
    enter(opts = {}) {
      const S = api.S, v = S.view;
      if (!v || !S.OCL) return null;
      const calm = clamp(opts.calm ?? 0.7, 0, 1);
      let seed = (opts.seed >>> 0) || 1;
      const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      const label = typeof opts.label === 'function' ? opts.label : null;
      document.documentElement.classList.add('sn-saver');
      const saved = { synth: S.synth, layout: S.layout, loop: v.loop };
      v.controls.enabled = false; v.loop = false;
      // the shot list: each synthesis grows, then up to three of its steps
      const shots = [];
      for (const id of shuffle(SYNTHS.slice())) {
        shots.push({ kind: 'tree', id, layout: ['clado', 'clado', 'radial', 'fan'][Math.floor(rnd() * 4)] });
        const n = NAMED.find(x => x.id === id).steps.length, ks = shuffle([...Array(n).keys()]).slice(0, 3).sort((a, b) => a - b);
        for (const k of ks) shots.push({ kind: 'step', id, k });
      }
      run = { seed0: (opts.seed >>> 0) || 1, saved, shots, i: -1, shot: null, t0: 0, raf: 0, fade: 1, going: false };
      const stage = document.getElementById('stage');
      // the clear band of the plate, in this page's CSS px
      const frameBand = () => {
        const W = innerWidth, H = innerHeight, b = plateBand(H);
        if (!b && run.rect) return run.rect;
        const top = b ? b.t : 0, bot = b ? b.b : 0, w = b ? Math.min(W, b.w) : W;
        return (run.rect = { x: (W - w) / 2 + w * 0.05, y: top, w: w * 0.9, h: Math.max(0.3 * H, H - top - bot) });
      };
      const plate = () => {
        if (!label || !run || !run.shot) return;
        const s = run.shot, N = NAMED.find(x => x.id === s.id), syn = s.syn;
        if (s.kind === 'tree') {
          const leaves = syn.nodes.filter(n => n.step < 0).map(n => n.mol.name);
          label({ title: N.name, sub: `${syn.steps.length} step${syn.steps.length > 1 ? 's' : ''} from ${leaves.slice(0, 4).join(', ')}`,
            tex: syn.steps.slice(-2).map(x => x.st.tex), lines: [N.d] });
        } else {
          const st = syn.steps[s.k].st, cls = CLASS[st.cls];
          label({ title: cls.name, sub: `Step ${s.k + 1} of ${syn.steps.length} · ${N.name}`, tex: [st.tex],
            lines: [cls.d, 'Illustration of the change in 3D, not a simulated trajectory'] });
        }
      };
      const apply = s => {
        s.syn = synthOf(s.id);
        stage.classList.toggle('sv-tree', s.kind === 'tree');
        stage.classList.toggle('sv-step', s.kind === 'step');
        if (s.kind === 'tree') {
          S.layout = s.layout;
          S.synth = s.syn; S.node = -1;
          const lay = layout(s.syn, s.layout, 150);
          S.tree.set(s.syn, lay, { d3: false, eq: true, art: api.art });
          S.tree.grow(0); v.pause();
          s.dur = clamp((4.5 + 1.1 * s.syn.steps.length + 2.5 * calm) * 1000, 5000, 12000);
        } else {
          const st = s.syn.steps[s.k].st;
          const sc = makeScene(st, { turn: 1.5 + 1.5 * calm });
          v.setScene(sc); v.userCam = false; v.play(0);
          s.dur = clamp(sc.T * 1000, 5000, 12000);
          v.setRect(frameBand());
        }
      };
      const start = () => {
        run.i = (run.i + 1) % shots.length;
        run.shot = shots[run.i];
        try { apply(run.shot); } catch (e) { console.error(e); run.shot.dur = 100; }
        run.t0 = performance.now();
        plate();
      };
      const fadeTo = fn => {
        if (run.going) return; run.going = true;
        const t0 = performance.now();
        const step = () => {
          if (!run) return;
          const k = (performance.now() - t0) / 600;
          if (k < 1) { run.fade = 1 - k; requestAnimationFrame(step); return; }
          run.fade = 0; fn();
          const t1 = performance.now();
          const up = () => { if (!run) return; const u = (performance.now() - t1) / 700; run.fade = Math.min(1, u); if (u < 1) requestAnimationFrame(up); else run.going = false; };
          // the plate text changes the band: wait a moment before the fade in
          setTimeout(() => { if (!run) return; run.t0 += performance.now() - t1; requestAnimationFrame(up); }, 350);
        };
        requestAnimationFrame(step);
      };
      const tick = now => {
        if (!run) return;
        run.raf = requestAnimationFrame(tick);
        const s = run.shot; if (!s) return;
        const u = (now - run.t0) / s.dur;
        if (s.kind === 'tree') {
          const r = frameBand(), wr = S.tree.wrap.getBoundingClientRect();
          if (!s.fitted || s.rk !== JSON.stringify(r)) { s.rk = JSON.stringify(r); s.fitted = true; S.tree.fitRect({ x: r.x - wr.left, y: r.y - wr.top, w: r.w, h: r.h }); }
          S.tree.grow(clamp(u / 0.75, 0, 1));
          if (u > 0.78 && !s.pushed) { s.pushed = true; S.tree.focusIn(s.syn.root, { x: r.x - wr.left, y: r.y - wr.top, w: r.w, h: r.h }, 1.5); S.tree.light(s.syn.root); }
        } else v.setRect(frameBand());
        stage.style.opacity = String(run.fade);
        if (u >= 1 && !run.going) fadeTo(start);
      };
      start();
      run.raf = requestAnimationFrame(tick);
      return { canvas: v.canvas, warmupMs: 900 };
    },
    exit() {
      if (!run) return;
      cancelAnimationFrame(run.raf);
      const saved = run.saved; run = null;
      const S = api.S, v = S.view, stage = document.getElementById('stage');
      document.documentElement.classList.remove('sn-saver');
      stage.classList.remove('sv-tree', 'sv-step'); stage.style.opacity = '';
      if (v) { v.controls.enabled = true; v.setRect(null); v.loop = saved.loop; }
      S.layout = saved.layout;
      if (saved.synth) api.showSynth(saved.synth, { grow: false, noHash: true });
    },
    debug() {
      if (!run) return null;
      const s = run.shot;
      return { seed: run.seed0, i: run.i, n: run.shots.length, kind: s && s.kind, synth: s && s.id, step: s && s.k, dur: s && s.dur, fade: run.fade, rect: run.rect };
    },
  };
}
