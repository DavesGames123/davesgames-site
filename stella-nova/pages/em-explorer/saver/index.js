// ============================================================================
//  EM EXPLORER  ·  saver/index.js — the screensaver hook (SAVER package)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js "Page protocol").
//  main.js loads this module with import() at its end, so a fault here
//  cannot stop the page.
//
//  enter(opts) waits for CORE (window.__em.ready), puts class sn-saver on
//  <html> (style.css hides the page chrome), hides the VIEW overlay and
//  the CORE messages, and starts the director (saver/director.js). The
//  director flies between CATALOG bookmarks: 5 to 12 s each, a fade to
//  black at each change of dataset or plane, a prefetch of the next shot
//  during each hold. It returns { canvas: #view, warmupMs }.
//
//  Framing. Every 250 ms the hook reads the clear band between the plate
//  texts (lib/saver-clear.js plateBand), eases to it and gives it to VIEW
//  (saverShots.setBand), so VIEW centres each view in the band. The same
//  band sets the zoom (plan.js frameZoom), at 16:9 and in the 9:16 column.
//  The plate shows the place, its caption, the field of view and the
//  dataset credit.
//
//  exit() stops the director and puts back the dataset and the view that
//  were on screen before enter().
//
//  grep -n targets
//    enter ............ "async enter"
//    band and veil .... "function tick"
//    exit ............. "exit()"
//    probe ............ "snSaver.debug"
// ============================================================================
import { plateBand } from '../../../lib/saver-clear.js';
import { createDirector } from './director.js';
import { clearBox, bandStep } from './plan.js';
import { placeTitle, creditLine } from '../ui/panels.js';
import { fmtVoxel, fmtLength } from '../ui/format.js';

const CSS = 'html.sn-saver .emv-ov,html.sn-saver #nonet,html.sn-saver #nogl{display:none!important}' +
  '#emSaverVeil{position:fixed;inset:0;background:#000;pointer-events:none;z-index:40;opacity:1}';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let run = null;

window.snSaver = {
  async enter(o = {}) {
    if (run) this.exit();
    const em = window.__em;
    if (!em) throw new Error('em-explorer saver: no window.__em');
    await Promise.race([Promise.resolve(em.ready).catch(() => false), sleep(10000)]);
    const viewer = em.viewer, canvas = document.getElementById('view');
    if (!viewer || !viewer.saverShots || !canvas) throw new Error('em-explorer saver: no viewer (WebGL2?)');

    let saved = null;
    try { saved = em.state(); } catch (e) { /* CORE */ }
    const html = document.documentElement;
    const css = document.createElement('style'); css.textContent = CSS; document.head.appendChild(css);
    const veil = document.createElement('div'); veil.id = 'emSaverVeil'; document.body.appendChild(veil);
    html.classList.add('sn-saver');
    try { viewer.setInsets({ top: 0, right: 0, bottom: 0, left: 0 }); } catch (e) { /* VIEW */ }

    const hasLabel = typeof o.label === 'function';
    const r = { em, viewer, saved, css, veil, raf: 0, last: 0, bandAt: 0, tgt: { t: 0, b: 0 }, cur: { t: 0, b: 0 }, sent: null, director: null };
    run = r;
    const box = () => clearBox(innerWidth, innerHeight, r.tgt);

    // the band ease, every frame
    const tick = (t) => {
      if (run !== r) return;
      const dt = r.last ? Math.min(0.1, (t - r.last) / 1000) : 0.016; r.last = t;
      if (hasLabel && t - r.bandAt > 250) {
        r.bandAt = t;
        const b = plateBand(innerHeight);
        r.tgt = b ? { t: b.t, b: b.b } : { t: 0, b: 0 };
      }
      r.cur = bandStep(r.cur, r.tgt, dt);
      const s = r.sent;
      if (!s || Math.abs(s.t - r.cur.t) > 0.5 || Math.abs(s.b - r.cur.b) > 0.5) {
        r.sent = { t: r.cur.t, b: r.cur.b };
        try { viewer.saverShots.setBand(r.sent); } catch (e) { /* VIEW */ }
      }
      r.raf = requestAnimationFrame(tick);
    };
    r.raf = requestAnimationFrame(tick);

    r.director = createDirector({
      em, viewer, box,
      label: hasLabel ? o.label : null,
      now: () => performance.now(),
      wait: sleep,
      frame: () => new Promise((res) => requestAnimationFrame(() => res())),
      calm: o.calm, seed: (o.seed >>> 0) || 1,
      onVeil: (k) => { veil.style.opacity = String(Math.max(0, Math.min(1, k))); },
      text: { placeTitle, creditLine, fmtVoxel, fmtLength },
    });
    r.director.start();
    return { canvas, warmupMs: 2500 };
  },

  exit() {
    const r = run;
    if (!r) return;
    run = null;
    cancelAnimationFrame(r.raf);
    if (r.director) r.director.stop();
    const { em, viewer, saved } = r;
    try { viewer.saverShots.setBand(null); } catch (e) { /* VIEW */ }
    document.documentElement.classList.remove('sn-saver');
    r.veil.remove(); r.css.remove();
    // put back what the reader had
    try {
      const v = saved && saved.view;
      const view = v && [v.x, v.y, v.z].every(Number.isFinite) ? { x: v.x, y: v.y, z: v.z, zoom: v.zoom, plane: v.plane } : null;
      // the reader's image: their own window, or CORE's auto mode
      const image = saved ? { contrast: saved.auto ? null : saved.contrast, invert: !!saved.invert } : null;
      const putImage = () => {
        if (image && typeof em.setImage === 'function') { em.setImage(image); return; }
        const core = em.state(), c = core.contrast;
        if (c) viewer.setContrast(c.lo / 255, c.hi / 255, c.gamma);
        viewer.setInvert(!!core.invert);
      };
      if (saved && saved.dataset && em.state().dataset !== saved.dataset) {
        Promise.resolve(em.selectDataset(saved.dataset, { view })).then((ok) => { if (ok && !run) putImage(); }, () => {});
      } else if (saved) {
        if (view) viewer.goTo(view);
        putImage();
      }
    } catch (e) { /* CORE or VIEW */ }
    // CORE puts its insets back on a resize
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* old browser */ }
  },
};

// For a probe: the shot on screen, its phase, and the faults so far.
window.snSaver.debug = () => (run && run.director ? { ...run.director.debug(), band: { ...run.cur } } : null);
// For a probe: the director's event log (cuts, shots, shot ends, faults).
window.snSaver.log = () => (run && run.director ? run.director.log.slice() : null);
