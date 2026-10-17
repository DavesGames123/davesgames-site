// ============================================================================
//  TENSOR CALCULUS  ·  saver/index.js  ·  window.snSaver  (SAVER)
// ----------------------------------------------------------------------------
//  The screensaver hook of the page. main.js (SAVER SEAM) imports this
//  module and calls installSaver(window.tensorPage, internals) once after
//  boot. installSaver sets window.snSaver; CORE does not.
//
//  window.snSaver
//    enter(opts)  opts = { calm, seconds, caption, seed, label, labels,
//                 channel? } from lib/screensaver.js. It hides the page UI
//                 (class sn-saver and tc-saver on <html>), builds a seeded
//                 shot plan (director.js) and starts it. It returns
//                 { canvas: #vizCanvas (in the document), warmupMs }.
//    exit()       stops the plan and gives back the layout, the entry, the
//                 step, the speed, the scene and the camera of the reader.
//    channels     the channel ids: all, geometry, relativity, notation,
//                 derivations. The channel comes from opts.channel, else
//                 from the URL (#saver=<id> or ?saver=<id>), else 'all'
//                 (a rotation through the other four).
//    setChannel(id), cut() (the next shot now), debug()
//
//  EACH SHOT  (director.js has the kinds)
//    3D shot     layout 'viz'; the player pauses and the 3D view goes free
//                (internals.setFree); viz.setShot with a camera from
//                cameraFor(); setViewOffset moves the subject into the
//                clear band; a push-in glides the camera over the hold.
//    entry shot  layout pair (diagram and 3D), diagram, or TeX and diagram;
//                tensorPage.openEntry plays the trace; pickWindow() sets
//                the speed and the first step so the derivation ends in
//                the hold. The 'step' event of the page sends the new TeX,
//                step label and code extract to the plate.
//  The plate (opts.label) gets labelFor(): title, sub, live TeX with index
//  colours (tex, rules), params (VIZ readouts or step / dimension /
//  metric), notes, and a real code extract that this module reads from
//  tensor/ or viz/ (fetch, once per file).
//
//  The scene clock runs slower in saver mode (calm): the module wraps
//  viz.setTime, which CORE calls each frame, and puts it back on exit.
//
//  EXPORTS   installSaver(api, internals, deps) -> saver
//    deps (all optional, for node tests): { win, doc, plateBand, now,
//    setInterval, clearInterval, loadText(url) -> Promise<string> }
//
//  grep -n targets: "export function installSaver", "function begin",
//  "function tick", "function relabel", "function applyFrame",
//  "function restore", "const CSS"
// ============================================================================
import * as D from './director.js';
import { plateBand as shellBand } from '../../../lib/saver-clear.js';

const CSS = `
html.tc-saver,html.tc-saver body{background:#05060a;cursor:none}
html.tc-saver .topbar,html.tc-saver #panel,html.tc-saver #player,html.tc-saver #dock,html.tc-saver #credits,
html.tc-saver #swipeDots,html.tc-saver #stepList,html.tc-saver .pane-head,html.tc-saver .view-hint,html.tc-saver #sceneBox,
html.tc-saver .note-pop,html.tc-saver #toast,html.tc-saver #texStepLabel,html.tc-saver #texIndexInfo,html.tc-saver #followBtn{display:none!important}
html.tc-saver #stage{position:fixed!important;top:var(--tcs-t,0px)!important;left:var(--tcs-l,0px)!important;right:var(--tcs-r,0px)!important;
  bottom:var(--tcs-b,0px)!important;padding:0!important;gap:var(--tcs-gap,0px)!important;display:grid!important;overflow:hidden!important;
  scroll-snap-type:none!important;background:transparent!important}
html.tc-saver #stage[data-mode="focus"]{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important}
html.tc-saver #stage[data-mode="pair"]{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important}
html.tc-saver.tcs-tall #stage[data-mode="pair"]{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr) minmax(0,1fr)!important}
html.tc-saver #stage .pane{grid-column:auto!important;grid-row:auto!important;border:0!important;border-radius:0!important;
  background:transparent!important;flex:none!important;width:auto!important;min-width:0;min-height:0}
html.tc-saver .tex-body{overflow:hidden;justify-content:center;align-items:center;padding:2vmin}
html.tc-saver .tex-line{font-size:clamp(1.1rem,3.4vmin,2.2rem)!important}
`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };

export function installSaver(api, internals, deps = {}) {
  const win = deps.win || (typeof window !== 'undefined' ? window : globalThis);
  const doc = deps.doc || win.document;
  const now = deps.now || (() => (win.performance ? win.performance.now() : Date.now()));
  const every = deps.setInterval || ((fn, ms) => win.setInterval(fn, ms));
  const stopEvery = deps.clearInterval || (id => win.clearInterval(id));
  const band = deps.plateBand || shellBand;
  const loadText = deps.loadText || (u => fetch(new URL('../' + u, import.meta.url)).then(r => (r.ok ? r.text() : null)));
  const I = internals || {};
  const views = I.views || {};
  const viz = views.viz || {};
  const player = I.player || {};
  const root = doc.documentElement;
  const code = new Map();   // file -> text | null | Promise
  let catalog = null, run = null;

  function catalogNow() {
    if (!catalog) catalog = D.buildCatalog(I.packages && I.packages.library, viz.saverShots && viz.saverShots.length ? viz.saverShots : undefined);
    return catalog;
  }

  // ── code extracts ──
  function codeFor(shot, step) {
    const ref = D.codeRef(shot, step);
    if (!ref) return null;
    const [file, marker] = ref;
    const src = code.get(file);
    if (typeof src === 'string') {
      const text = D.extractBlock(src, marker);
      const fn = (/function\s*\*?\s*([A-Za-z0-9_]+)/.exec(marker) || /^\s*([A-Za-z0-9_]+):/.exec(marker) || [])[1] || '';
      return text ? { name: `${file} · ${fn}`, text } : null;
    }
    ensure(file);
    return null;
  }
  // read a source file once; the plate gets the extract when it arrives
  function ensure(file) {
    if (code.has(file)) return;
    const p = safe(() => Promise.resolve(loadText(file)), Promise.resolve(null));
    code.set(file, p);
    p.then(t => { code.set(file, typeof t === 'string' ? t : null); if (run) relabel(); }, () => code.set(file, null));
  }

  // ── framing ──
  function size() { return { W: win.innerWidth || 1280, H: win.innerHeight || 720 }; }
  function frame(layout) {
    const { W, H } = size();
    let b = null;
    if (run && run.shell) { b = safe(() => band(H), null); if (b) run.band = b; else b = run.band; }
    return D.frameFor(W, H, b, layout);
  }
  function applyFrame(fr) {
    const key = JSON.stringify([fr.stage, fr.offset, fr.tall, fr.layout]);
    if (run.frameKey === key) return;
    run.frameKey = key;
    const st = root.style;
    st.setProperty('--tcs-t', fr.stage.top + 'px'); st.setProperty('--tcs-l', fr.stage.left + 'px');
    st.setProperty('--tcs-r', fr.stage.right + 'px'); st.setProperty('--tcs-b', fr.stage.bottom + 'px');
    st.setProperty('--tcs-gap', fr.layout === 'viz' ? '0px' : Math.round(Math.min(fr.box.w, fr.box.h) * 0.03) + 'px');
    root.classList.toggle('tcs-tall', !!fr.tall);
    safe(() => viz.setViewOffset && viz.setViewOffset(fr.layout === 'viz' ? fr.offset.x : 0, fr.layout === 'viz' ? fr.offset.y : 0));
    safe(() => viz.resize && viz.resize());
    safe(() => views.diagram && views.diagram.resize && views.diagram.resize());
  }

  // ── the plate ──
  function relabel() {
    if (!run || !run.shot || !run.label) return;
    const shot = run.shot, S = I.store || {};
    const fr = run.frame || frame(shot.layout);
    const pos = safe(() => player.position(), null);
    const steps = shot.entry ? safe(() => player.steps(), []) : [];
    const index = pos && pos.index >= 0 ? pos.index : 0;
    const step = shot.entry && run.entryReady ? steps[index] || null : null;
    const pal = I.palette;
    const info = D.labelFor(shot, {
      step, index, count: run.entryReady ? steps.length : 0, trace: run.entryReady ? S.trace : null,
      reads: shot.entry ? null : safe(() => viz.readouts(), null),
      code: codeFor(shot, step), slotOf: pal && pal.indexSlot ? s => pal.indexSlot(s) : undefined,
      anchor: fr.anchor, channel: run.channel, style: run.style,
    });
    safe(() => run.label(info));
    run.lastLabel = info;
  }

  // ── shots ──
  function nextShot() {
    if (!run.plan.length || run.k >= run.plan.length) {
      run.seed = (Math.imul(run.seed, 1664525) + 1013904223) >>> 0;
      const last = run.shot ? run.shot.subject : null;
      run.plan = D.buildPlan(catalogNow(), { seed: run.seed, channel: run.channel, calm: run.calm, avoid: last });
      run.k = 0;
    }
    return run.plan[run.k++];
  }

  function begin(shot) {
    const token = ++run.token;
    run.shot = shot; run.t0 = now(); run.entryReady = false; run.styleK = 0; run.style = null;
    run.frame = frame(shot.layout);
    applyFrame(run.frame);
    const L = I.layout;
    if (shot.layout === 'viz') {
      safe(() => player.pause());
      safe(() => I.setFree && I.setFree(true));
      if (L) safe(() => L.set('viz'));
      const cam = D.cameraFor(shot, run.frame.dist, 'start');
      if (viz.setShot) safe(() => viz.setShot({ scene: shot.scene, params: shot.params, camera: cam }, shot.kind === 'push' ? 0 : 1400));
      else if (api && api.setScene) safe(() => api.setScene(shot.scene, shot.params));
      if (shot.kind === 'push' && viz.setCamera) safe(() => viz.setCamera(D.cameraFor(shot, run.frame.dist, 'end'), Math.round(shot.hold * 1000)));
      relabel();
      return Promise.resolve(true);
    }
    const spec = shot.layout === 'pair' ? (shot.n % 2 ? ['viz', 'diagram'] : ['diagram', 'viz'])
      : shot.layout === 'texdiagram' ? ['tex', 'diagram'] : ['diagram'];
    run.style = D.STYLE_CYCLE[shot.kind === 'diagram' ? shot.style0 : 0];
    if (L) safe(() => L.set({ views: spec, style: run.style }));
    safe(() => viz.setOrbit && viz.setOrbit(0.8 * (shot.spin || 1)));
    relabel();
    return Promise.resolve()
      .then(() => api.openEntry(shot.entry, null, { autoplay: false, noHash: true }))
      .then(() => {
        if (!run || token !== run.token) return false;
        const w = D.pickWindow(safe(() => player.timeline(), []), shot.hold * 1000 * 0.95);
        safe(() => player.setSpeed(w.speed));
        safe(() => player.seek(w.step, 0));
        safe(() => player.play());
        run.entryReady = true;
        relabel();
        return true;
      })
      .catch(() => { if (run && token === run.token) run.skip = true; return false; });
  }

  function tick() {
    if (!run || !run.shot) return;
    const shot = run.shot, t = (now() - run.t0) / 1000;
    if (run.skip || t >= shot.hold) { run.skip = false; begin(nextShot()); return; }
    if (shot.kind === 'diagram') {
      const k = Math.min(D.STYLE_CYCLE.length - 1, Math.floor((3 * t) / shot.hold));
      if (k !== run.styleK) {
        run.styleK = k; run.style = D.STYLE_CYCLE[(shot.style0 + k) % D.STYLE_CYCLE.length];
        if (I.layout) safe(() => I.layout.set({ style: run.style }));
        relabel();
      }
    }
    const fr = frame(shot.layout);
    run.frame = fr;
    applyFrame(fr);
    if (now() - run.labelAt > 1000) { run.labelAt = now(); relabel(); }
  }

  // ── restore ──
  function snapshot() {
    const S = I.store || {};
    const pos = safe(() => player.position(), {}) || {};
    return {
      entryId: S.entryId || null, trace: S.entryId ? null : S.trace || null,
      layout: S.layout ? { views: S.layout.views.slice(), style: S.layout.style } : null,
      scene: S.scene ? { id: S.scene.id, params: { ...(S.scene.params || {}) } } : null,
      vizFree: !!S.vizFree, index: pos.index >= 0 ? pos.index : 0, t: pos.t || 0,
      playing: !!pos.playing, speed: pos.speed || 1,
      stepPause: !!safe(() => player.stepPause && player.stepPause(), false),
    };
  }
  function restore(s) {
    const L = I.layout;
    if (L && s.layout) safe(() => L.set({ views: s.layout.views, style: s.layout.style }));
    safe(() => viz.setViewOffset && viz.setViewOffset(0, 0));
    safe(() => viz.setOrbit && viz.setOrbit(0));
    let p = Promise.resolve();
    if (s.entryId) p = p.then(() => api.openEntry(s.entryId, null, { autoplay: false, noHash: true }));
    else if (s.trace) p = p.then(() => api.playTrace(s.trace, { autoplay: false }));
    return p.then(() => {
      safe(() => player.setSpeed(s.speed));
      safe(() => player.setStepPause && player.setStepPause(s.stepPause));
      if (s.entryId || s.trace) { safe(() => player.seek(s.index, s.t)); if (s.playing) safe(() => player.play()); }
      if (s.vizFree && s.scene && s.scene.id) safe(() => api.setScene(s.scene.id, s.scene.params));
      const id = s.scene && s.scene.id;
      const info = id && viz.sceneInfo ? safe(() => viz.sceneInfo(id), null) : null;
      if (info && info.camera && viz.setCamera) safe(() => viz.setCamera({ ...info.camera, orbit: 0 }, 900));
      safe(() => viz.resize && viz.resize());
    }).catch(() => {});
  }

  function channelFromUrl() {
    const loc = safe(() => String(win.location.hash || '') + '&' + String(win.location.search || ''), '');
    const m = /[#?&]saver=([a-z]+)/.exec(loc);
    return m && D.CHANNELS.includes(m[1]) ? m[1] : null;
  }

  let style = null;
  function addStyle() {
    if (style || !doc.createElement) return;
    style = doc.createElement('style');
    style.id = 'tcSaverStyle';
    style.textContent = CSS;
    (doc.head || root).appendChild(style);
  }

  const saver = {
    get active() { return !!run; },
    channels: D.CHANNELS.slice(),
    enter(opts = {}) {
      if (run) saver.exit();
      const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
      const channel = D.CHANNELS.includes(opts.channel) ? opts.channel : channelFromUrl() || 'all';
      run = {
        shell: typeof opts.label === 'function', label: typeof opts.label === 'function' ? opts.label : null,
        seed, channel, calm: clamp(opts.calm ?? 0.7, 0, 1), plan: [], k: 0, token: 0, shot: null,
        saved: snapshot(), band: null, frameKey: null, labelAt: now(), skip: false,
      };
      // the saver plays steps without stopping; snapshot() kept the reader's choice
      safe(() => player.setStepPause && player.setStepPause(false));
      run.plan = D.buildPlan(catalogNow(), { seed, channel, calm: run.calm });
      addStyle();
      root.classList.add('sn-saver', 'tc-saver');
      // a slower scene clock: CORE calls viz.setTime(seconds) each frame
      if (typeof viz.setTime === 'function' && !viz.__tcSaverTime) {
        const orig = viz.setTime, k = 1 - 0.45 * run.calm;
        let base = null, s0 = 0;
        viz.setTime = s => { if (base == null) { base = +s || 0; s0 = base; } return orig.call(viz, s0 + ((+s || 0) - base) * k); };
        viz.__tcSaverTime = orig;
      }
      for (const f of D.CODE_FILES) ensure(f);
      run.off = api && api.on ? safe(() => api.on('step', () => { if (run && run.shot && run.shot.entry) relabel(); }), null) : null;
      begin(nextShot());
      run.timer = every(tick, 250);
      const canvas = doc.getElementById ? doc.getElementById('vizCanvas') : null;
      return { canvas: canvas && (canvas.isConnected !== false) ? canvas : null, warmupMs: 1500 };
    },
    exit() {
      if (!run) return;
      const r = run;
      run = null;
      stopEvery(r.timer);
      if (typeof r.off === 'function') safe(() => r.off());
      if (viz.__tcSaverTime) { viz.setTime = viz.__tcSaverTime; delete viz.__tcSaverTime; }
      root.classList.remove('sn-saver', 'tc-saver', 'tcs-tall');
      for (const k of ['--tcs-t', '--tcs-l', '--tcs-r', '--tcs-b', '--tcs-gap']) safe(() => root.style.removeProperty(k));
      if (r.label) safe(() => r.label(null));
      return restore(r.saved);
    },
    setChannel(id) {
      if (!D.CHANNELS.includes(id)) return false;
      if (!run) return true;
      run.channel = id;
      run.plan = D.buildPlan(catalogNow(), { seed: run.seed, channel: id, calm: run.calm, avoid: run.shot && run.shot.subject });
      run.k = 0;
      begin(nextShot());
      return true;
    },
    cut() { if (!run) return false; begin(nextShot()); return true; },
    tick,
    debug() {
      if (!run) return null;
      return { channel: run.channel, seed: run.seed, shot: run.shot && { key: run.shot.key, kind: run.shot.kind, hold: run.shot.hold }, k: run.k, plan: run.plan.length, frame: run.frame, label: run.lastLabel };
    },
  };

  win.snSaver = {
    enter: opts => saver.enter(opts),
    exit: () => saver.exit(),
    channels: saver.channels,
    setChannel: id => saver.setChannel(id),
    cut: () => saver.cut(),
    debug: () => saver.debug(),
  };
  return saver;
}
