// ============================================================================
//  MRNA VACCINE  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page, puts one full-window canvas on top and plays a seeded shuffle
//  of four shots (data.js shotPlan): the LNP journey, translation to
//  spikes, the 2P spike, and the strand. Each shot lasts 5 to 12 s, with a
//  fade between shots and a slow push-in. The subject is framed in the
//  clear band between the shell plate texts (lib/saver-clear.js).
//  The page loop in main.js stops while window.__mvSaver is true.
//
//  grep -n targets
//    shot list and plates ... "const SHOTS"
//    frame loop ............. "function frame"
// ============================================================================
import { shotPlan, buildStrand, LNP } from './data.js';
import { PAL, drawJourney, drawTranslate, drawSpike, drawStrand, strandWidth } from './draw.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

const STRAND = buildStrand({ opt: 1, p2: true });
// Each shot: plate (for the shell poster) and draw(g, w, h, k, tau, calm).
// k is 0..1 through the shot, tau its seconds. draw returns the subject
// { x, y, r } in canvas px, for the plate anchor.
const SHOTS = {
  lnp: {
    plate: { title: 'A lipid nanoparticle delivers mRNA', sub: 'ionizable lipids turn positive in the acid endosome', tex: ['f_{+} = \\frac{1}{1 + 10^{\\,\\mathrm{pH} - \\mathrm{p}K_a}}'], rules: [['\\mathrm{pH}', 'm2'], ['\\mathrm{p}K_a', 'm1']], lines: ['Schematic, not to scale'] },
    draw: (g, w, h, k, tau) => drawJourney(g, w, h, { p: 0.04 + 0.96 * k, t: tau, pKa: LNP.pKa }),
  },
  translate: {
    plate: { title: 'Ribosomes read the message', sub: 'each finished chain folds into spike protein for the cell surface', tex: ['t_{1/2} = \\frac{\\ln 2}{k}'], rules: [['k', 'm1']], lines: ['Several ribosomes read one mRNA at once', 'The mRNA itself decays within days'] },
    draw: (g, w, h, k, tau, calm) => drawTranslate(g, w, h, { t: 34 + tau * (1 - 0.35 * calm) }),
  },
  spike: {
    plate: { title: 'The spike, held prefusion', sub: 'two prolines block the helix the spike needs to fire', tex: ['\\mathrm{K986P},\\ \\mathrm{V987P}'], lines: ['First locked: RSV F (2013), MERS spike (2017)', 'Shown here: with 2P it holds; without, it springs'] },
    draw: (g, w, h, k, tau) => {
      // first half: 2P on, a trigger shakes it; second half: 2P off, it fires
      const second = k > 0.5;
      const shake = !second && k > 0.18 && k < 0.42 ? Math.sin((k - 0.18) / 0.24 * Math.PI) : 0;
      const m = second ? smooth((k - 0.58) / 0.3) : 0;
      return drawSpike(g, w, h, { m, p2: !second, shake, t: tau, labels: false });
    },
  },
  strand: {
    plate: { title: 'The message, base by base', sub: "cap · 5' UTR · coding sequence · 3' UTR · poly(A) tail", tex: ['\\mathrm{U} \\;\\rightarrow\\; \\mathrm{m^{1}\\Psi}'], lines: ['Every uridine is N1-methylpseudouridine', 'UTR letters and codon choices illustrative'] },
    draw: (g, w, h, k, tau) => {
      const span = Math.max(0, strandWidth(STRAND) - w);
      drawStrand(g, w, h, { T: STRAND, offset: span * k, mod: true, time: tau });
      return { x: w / 2, y: h * 0.52, r: h * 0.35 };
    },
  },
};

let run = null;
window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || 1;
    const plan = shotPlan(seed, 64, calm);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__mvSaver = true;
    run = { plan, css, cv, raf: 0, i: 0, tau: 0, last: 0, plated: -1, subj: null };
    const g = cv.getContext('2d');
    const frame = now => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[run.i % plan.length];
      run.tau += dt;
      if (run.tau >= shot.sec) { run.tau = 0; run.i++; shot = plan[run.i % plan.length]; }
      const S = SHOTS[shot.id], k = run.tau / shot.sec;
      // the clear band between the plate texts
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const top = band ? band.t : 0, bot = band ? band.b : 0, bh = Math.max(120, h - top - bot);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
      // a slow push-in on the band centre
      const z = 1 + 0.08 * smooth(k);
      g.save();
      g.translate(w / 2, top + bh / 2); g.scale(z, z); g.translate(-w / 2, -bh / 2);
      g.beginPath(); g.rect(0, 0, w, bh); g.clip();
      let subj = null;
      try { subj = S.draw(g, w, bh, k, run.tau, calm); } catch (e) { /* a bad frame is skipped */ }
      g.restore();
      // fade at the cut
      const f = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.6 + 0.6 * calm));
      if (f < 1) { g.fillStyle = `rgba(5,7,12,${1 - f})`; g.fillRect(0, 0, w, h); }
      if (subj) run.subj = { x: w / 2 + (subj.x - w / 2) * z, y: top + bh / 2 + (subj.y - bh / 2) * z, r: subj.r * z };
      if (run.plated !== run.i && typeof o.label === 'function') {
        run.plated = run.i;
        try { o.label(Object.assign({}, S.plate, { anchor: () => run && run.subj ? { x: run.subj.x, y: run.subj.y, r: run.subj.r } : null })); } catch (e) { /* the plate is optional */ }
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
    run = null; window.__mvSaver = false;
  },
};
// The shot on screen, for a probe: index, id, seconds into it and its length.
window.snSaver.debug = () => run ? { i: run.i, id: run.plan[run.i % run.plan.length].id, tau: run.tau, sec: run.plan[run.i % run.plan.length].sec } : null;
