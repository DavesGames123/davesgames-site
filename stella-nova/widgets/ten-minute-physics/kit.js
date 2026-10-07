// ============================================================================
//  TEN MINUTE PHYSICS KIT  ·  widgets/ten-minute-physics/kit.js
// ----------------------------------------------------------------------------
//  Shared by every page that ports a demo from Ten Minute Physics, the
//  YouTube channel and demo set of Matthias Müller
//  (https://matthias-research.github.io/pages/tenMinutePhysics/). It does two
//  jobs, so the page main.js can stay a copy of the upstream demo:
//
//    1. Credit. TMP.page(info) writes the credit bar at the base of the page:
//       the author, the tutorial number, the video, the upstream code and the
//       licence. Every page calls it; the saver label repeats it.
//    2. Screensaver. TMP.saver(spec) defines window.snSaver (protocol in
//       lib/screensaver.js). It hides the page GUI, frames the sim canvas in
//       the clear band of the label plate (lib/saver-clear.js), and runs a
//       shot director: a seeded shuffle of spec.shots, one cut every 5-12 s.
//
//  Classic script, loaded in the page head after lib/stats-beacon.js. Load
//  order on a page:
//    head   gpu-guard, wishlist, stats-beacon, kit.js, kit.css, style.css
//    body   upstream markup, main.js (upstream code), saver.js (TMP calls)
//
//  TMP.page(info)
//    info = { n, title, file, video, year, licence, by?, from?, note? }
//      n        tutorial number as text ('17'), or null for a contribution
//      file     the upstream file under tenMinutePhysics/ ('17-fluidSim.html')
//      video    YouTube id of the tutorial, or null
//      year     copyright year of the upstream file
//      licence  'MIT' or null (no licence text upstream)
//      by       author when it is not Matthias Müller (contributions)
//      holder   copyright holder when the upstream notice names another
//               person than the author (default: by, else Matthias Müller)
//      from     author country, for contributions (as upstream lists it)
//
//  TMP.saver(spec)
//    spec.canvas()        returns the sim canvas element
//    spec.bg              page colour behind the canvas (default '#000')
//    spec.fit(w, h)       optional: resize the sim to w x h CSS px. Return
//                         true when the sim was rebuilt: the kit then runs
//                         the current shot again. Without fit, the kit
//                         scales the canvas box to the band.
//    spec.shots           [{ key, label, run(ctx) }]. label = plate fields
//                         (title, sub, lines, eq, code, params). run starts
//                         the shot; ctx = { rng, calm, w, h }. run may
//                         return a function that ends the shot.
//    spec.tick(dt, ctx)   optional: called each frame in saver mode
//    spec.enter(opts)     optional: before the first shot (hide extra GUI)
//    spec.exit()          optional: undo; without it the page reloads
//
//  grep -n targets
//    credit bar ........... "function creditHTML"
//    plate credit lines ... "function creditLines"
//    band and fit ......... "function frame"
//    shot director ........ "function nextShot"
//    hook ................. "window.snSaver ="
// ============================================================================
(function () {
'use strict';
if (window.TMP) return;
const HOME = 'https://matthias-research.github.io/pages/tenMinutePhysics/';
const CODE = 'https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/';
const MM = 'Matthias Müller';
let INFO = null;

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function creditHTML(i) {
  const who = i.by
    ? `<span>Contribution by <b>${esc(i.by)}</b>${i.from ? ' (' + esc(i.from) + ')' : ''} to <a href="${HOME}" target="_blank" rel="noopener">Ten Minute Physics</a> by <b>${MM}</b></span>`
    : `<span>Simulation by <b>${MM}</b> · <a href="${HOME}" target="_blank" rel="noopener">Ten Minute Physics</a>${i.n ? ' #' + esc(i.n) : ''}</span>`;
  const links = [];
  if (i.video) links.push(`<a href="https://youtu.be/${esc(i.video)}" target="_blank" rel="noopener">▶ Video tutorial</a>`);
  links.push(`<a href="${CODE}${esc(i.file)}" target="_blank" rel="noopener">Original code</a>`);
  const lic = i.licence
    ? `<span class="lic">© ${esc(i.year)} ${esc(i.holder || i.by || MM)} · ${esc(i.licence)} License</span>`
    : `<span class="lic">© ${esc(i.year || '')} ${esc(i.holder || i.by || MM)} · all rights reserved</span>`;
  return who + links.join('') + lic;
}

// The credit for the saver plate: it is in every recording, because the
// plate is drawn into the file and the credit bar is hidden.
function creditLines() {
  const i = INFO || {};
  const out = [];
  out.push(i.by ? `Simulation by ${i.by}, a Ten Minute Physics contribution` : `Simulation by ${MM} · Ten Minute Physics${i.n ? ' #' + i.n : ''}`);
  if (i.video) out.push(`Tutorial: youtu.be/${i.video}`);
  return out;
}

function page(info) {
  INFO = info;
  const put = () => {
    if (document.getElementById('tmp-credit')) return;
    const bar = document.createElement('footer');
    bar.id = 'tmp-credit';
    bar.innerHTML = creditHTML(info);
    document.body.appendChild(bar);
    document.body.classList.add('tmp-has-credit');
  };
  if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
}

// ---- screensaver ------------------------------------------------------------
function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s + 0x6D2B79F5) >>> 0; let x = Math.imul(s ^ s >>> 15, 1 | s); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

const KIT_SRC = document.currentScript && document.currentScript.src;

function saver(spec) {
  let on = false, savedStyle = null, opts = null, rng = null, order = [], pos = 0, cur = null, stopShot = null, timer = 0, raf = 0, last = 0, box = null, ctx = null;
  const calmOf = () => Math.max(0, Math.min(1, opts && opts.calm != null ? +opts.calm : 0.7));

  async function frame() {
    if (!on) return;
    const cv = spec.canvas(); if (!cv) return;
    const W = innerWidth, H = innerHeight;
    let band = null;
    try { const m = await import(new URL('../../lib/saver-clear.js', KIT_SRC || location.href).href); band = m.plateBand(H); } catch (e) { band = null; }
    const t = band ? band.t : 0, b = band ? band.b : 0;
    const bw = W, bh = Math.max(80, H - t - b);
    let w = bw, h = bh;
    let rebuilt = false;
    if (spec.fit) {
      rebuilt = !!spec.fit(w, h);
    } else {
      const a = (cv.width || 1) / (cv.height || 1);
      if (w / h > a) w = Math.round(h * a); else h = Math.round(w / a);
    }
    box = { x: Math.round((W - w) / 2), y: Math.round(t + (bh - h) / 2), w, h };
    if (savedStyle === null) savedStyle = cv.getAttribute('style') || '';
    cv.classList.add('tmp-saver-canvas');
    Object.assign(cv.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    if (ctx) { ctx.w = w; ctx.h = h; }
    if (rebuilt) restart();
  }

  // fit() rebuilt the sim at a new size: start the same shot again, with no
  // new label (the plate already names it).
  function restart() {
    if (!cur || !ctx) return;
    if (stopShot) { try { stopShot(); } catch (e) { console.error(e); } stopShot = null; }
    ctx.t = 0;
    try { stopShot = cur.run ? cur.run(ctx) || null : null; } catch (e) { console.error(e); }
  }

  function label(shot) {
    if (!opts || typeof opts.label !== 'function') return;
    const L = Object.assign({}, shot.label || {});
    L.sub = L.sub || (INFO && INFO.title) || '';
    L.lines = (L.lines || []).concat(creditLines());
    opts.label(L);
    setTimeout(frame, 80); setTimeout(frame, 750);
  }

  function nextShot(force) {
    if (!on) return;
    if (stopShot) { try { stopShot(); } catch (e) { console.error(e); } stopShot = null; }
    if (!order.length || pos >= order.length) {
      order = spec.shots.map((s, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      if (cur && order.length > 1 && spec.shots[order[0]] === cur) order.push(order.shift());
      pos = 0;
    }
    cur = force ? (spec.shots.find(s => s.key === force) || spec.shots[order[pos++]]) : spec.shots[order[pos++]];
    ctx = { rng, calm: calmOf(), w: box ? box.w : innerWidth, h: box ? box.h : innerHeight, shot: cur.key, t: 0 };
    label(cur);
    try { stopShot = cur.run ? cur.run(ctx) || null : null; } catch (e) { console.error(e); }
    clearTimeout(timer);
    const sec = (5 + rng() * 7) * (0.8 + 0.4 * calmOf());
    if (spec.shots.length > 1 || cur.repeat) timer = setTimeout(() => nextShot(), sec * 1000);
  }

  function loop(ts) {
    if (!on) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
    if (ctx) ctx.t += dt;
    if (spec.tick && ctx) { try { spec.tick(dt, ctx); } catch (e) { console.error(e); } }
    raf = requestAnimationFrame(loop);
  }

  const onResize = () => frame();

  window.snSaver = {
    enter(o) {
      opts = o || {}; on = true; rng = rngFrom(opts.seed); order = []; pos = 0;
      document.documentElement.style.setProperty('--tmp-saver-bg', spec.bg || '#000');
      document.documentElement.classList.add('tmp-saver');
      if (spec.enter) { try { spec.enter(opts); } catch (e) { console.error(e); } }
      addEventListener('resize', onResize);
      return frame().then(() => { nextShot(); last = 0; raf = requestAnimationFrame(loop); return { canvas: spec.canvas(), warmupMs: spec.warmupMs || 600 }; });
    },
    exit() {
      on = false; clearTimeout(timer); cancelAnimationFrame(raf); removeEventListener('resize', onResize);
      if (stopShot) { try { stopShot(); } catch (e) {} stopShot = null; }
      if (spec.exit) { spec.exit(); document.documentElement.classList.remove('tmp-saver'); const cv = spec.canvas(); if (cv) { cv.classList.remove('tmp-saver-canvas'); cv.setAttribute('style', savedStyle || ''); savedStyle = null; } }
      else location.reload();
    },
    cut(key) { nextShot(key); },
    debug() { return { on, shot: cur && cur.key, t: ctx && ctx.t, box, shots: spec.shots.map(s => s.key) }; },
  };
}

window.TMP = { page, saver, creditLines };
})();
