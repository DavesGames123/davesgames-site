// ============================================================================
//  EXPLODE BAR  ·  lib/explode-bar.js — the Explode control at the top of a
//  machine page's 3D view
// ----------------------------------------------------------------------------
//  The site owner asked: "all machines should have explode options in
//  buttons within their window layout prominently and towards the top (but
//  not for screensavers)". This module answers that request. It puts one
//  pill at the top of the view: an Explode toggle (icon + label) and three
//  steps (Assembled, Partly, Exploded). On a phone only the toggle shows.
//
//  OPT-IN (main.js, after the page's own setExplode)
//    import { createExplodeBar } from '../../lib/explode-bar.js';
//    createExplodeBar({ host: $('stage'), get: () => S.explodeTarget,
//                       set: setExplode, saver: () => saverOn });
//  The module adds lib/explode-bar.css itself.
//
//  OPTIONS
//    host ....... the view box (position: fixed or absolute). The bar is
//                 its last child.
//    get() ...... the page's explode target, 0..1 (not the eased value)
//    set(v) ..... the page's own explode setter. The page's loop eases the
//                 parts to the target with its own spring, so the bar adds
//                 no animation of its own.
//    steps ...... [assembled, partly, exploded] values (default [0, 0.5, 1])
//    saver() .... true while the page's snSaver tour runs. The bar also
//                 hides with html.sn-saver (the generic saver) and with
//                 body.sn-saver-on on a same-origin parent (the shell).
//    key ........ the shortcut key (default 'e'); null turns it off (a page
//                 that types letters, for example enigma-rotors)
//    avoid ...... selectors of the page's own top elements (default
//                 ['#read', '#hint']). The bar never covers a visible one.
//    occluders .. selectors of the side panels (default ['#panel',
//                 '#anaPanel']). The bar centres in the part they leave
//                 clear.
//
//  SYNC. A frame loop reads get() and updates aria-pressed, so the panel
//  slider, the view presets and the bar always agree. The panel keeps its
//  own slider and buttons.
//
//  GREP MAP
//    export function placeBar ....... pure layout: where the pill goes
//    export function inSaver ........ the saver test
//    export function createExplodeBar the DOM, the events and the loop
//    function onKey ................. the E shortcut
// ============================================================================

const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
  + '<rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.9"/>'
  + '<path d="M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  + '</svg>';
const STEP_NAMES = ['Assembled', 'Partly', 'Exploded'];
const NEAR = 0.02;
const PHONE = '(max-width:768px), (max-height:500px) and (pointer:coarse)';

// Pure layout. All rects are in host px: { l, t, r, b }. The pill wants the
// top centre of the clear band (a phone wants its right end: the readout
// sits at the top left). It tries that x, the two ends of the band and the
// x just past each avoid rect, and keeps the free x nearest to the wanted
// one. When no x at the top is free, it drops below the rects it touches,
// at the x that drops the least.
export function placeBar({ host, bar, clear, avoid = [], phone = false, pad = 12, gap = 6 }) {
  let L = Math.max(0, clear ? clear.l : 0), R = Math.min(host.w, clear ? clear.r : host.w);
  if (R - L < bar.w + 2 * pad) { L = 0; R = host.w; }
  const lo = L + pad, hi = Math.max(lo, R - pad - bar.w);
  const clamp = x => Math.min(hi, Math.max(lo, x));
  const want = phone ? hi : clamp((L + R - bar.w) / 2);
  const xs = [want, hi, lo];
  for (const a of avoid) xs.push(clamp(a.r + gap + 1), clamp(a.l - gap - 1 - bar.w));
  const hit = (x, y) => avoid.filter(a => a.r > x - gap && a.l < x + bar.w + gap && a.b > y - gap && a.t < y + bar.h + gap);
  const near = (p, q) => Math.abs(p.x - want) - Math.abs(q.x - want);
  const free = xs.filter(x => !hit(x, pad).length).map(x => ({ x, y: pad }));
  if (free.length) return free.sort(near)[0];
  const drops = xs.map(x => {
    let y = pad;
    for (let i = 0; i < 6; i++) { const h = hit(x, y); if (!h.length) break; y = Math.max(...h.map(a => a.b)) + gap + 2; }
    return { x, y: Math.min(y, Math.max(pad, host.h - bar.h - pad)) };
  });
  return drops.sort((p, q) => p.y - q.y || near(p, q))[0];
}

// true while a screensaver runs: the page flag, html.sn-saver (the generic
// saver), or body.sn-saver-on on a same-origin parent (the shell)
export function inSaver(win, extra) {
  try { if (extra && extra()) return true; } catch (e) { /* page flag throws: treat as off */ }
  const d = win.document;
  if (d.documentElement.classList.contains('sn-saver')) return true;
  try {
    const p = win.parent;
    if (p && p !== win && p.document && p.document.body && p.document.body.classList.contains('sn-saver-on')) return true;
  } catch (e) { /* cross-origin parent */ }
  return false;
}

export function createExplodeBar(o) {
  const host = o.host, doc = host.ownerDocument, win = doc.defaultView;
  const steps = (o.steps && o.steps.length === 3 ? o.steps : [0, 0.5, 1]).map(Number);
  const key = o.key === undefined ? 'e' : o.key;
  const avoidSel = o.avoid || ['#read', '#hint'];
  const occSel = o.occluders || ['#panel', '#anaPanel'];
  const phoneQ = win.matchMedia ? win.matchMedia(PHONE) : null;

  if (!doc.querySelector('link[data-sn-xbar]')) {
    const ln = doc.createElement('link');
    ln.rel = 'stylesheet'; ln.dataset.snXbar = '';
    try { ln.href = new URL('./explode-bar.css', import.meta.url).href; } catch (e) { ln.href = '../../lib/explode-bar.css'; }
    doc.head.appendChild(ln);
  }

  const el = doc.createElement('div');
  el.className = 'sn-xbar';
  // until the stylesheet loads and the first layout runs: out of the flow
  el.style.cssText = 'position:absolute;top:12px;left:12px;visibility:hidden';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Exploded view');
  const tog = doc.createElement('button');
  tog.type = 'button'; tog.className = 'sn-xbar-tog';
  tog.setAttribute('aria-pressed', 'false');
  tog.title = key ? `Explode the parts apart (${key.toUpperCase()})` : 'Explode the parts apart';
  if (key) tog.setAttribute('aria-keyshortcuts', key.toUpperCase());
  tog.innerHTML = ICON + '<span>Explode</span>' + (key ? `<kbd aria-hidden="true">${key.toUpperCase()}</kbd>` : '');
  const grp = doc.createElement('div');
  grp.className = 'sn-xbar-steps';
  grp.setAttribute('role', 'group');
  grp.setAttribute('aria-label', 'Explode amount');
  const stepBtns = steps.map((v, i) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.dataset.step = String(i);
    b.textContent = STEP_NAMES[i];
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { o.set(v); sync(); });
    grp.appendChild(b);
    return b;
  });
  el.append(tog, grp);
  host.appendChild(el);

  const exploded = () => +o.get() > steps[0] + NEAR;
  function toggle() { o.set(exploded() ? steps[0] : steps[2]); sync(); }
  tog.addEventListener('click', toggle);

  let last = NaN, lastHidden = null;
  function sync() {
    const hide = inSaver(win, o.saver);
    if (hide !== lastHidden) { el.hidden = hide; lastHidden = hide; }
    const v = +o.get();
    if (v === last) return;
    last = v;
    tog.setAttribute('aria-pressed', String(v > steps[0] + NEAR));
    tog.classList.toggle('on', v > steps[0] + NEAR);
    stepBtns.forEach((b, i) => { const on = Math.abs(v - steps[i]) < NEAR; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
  }

  function rectIn(e, hr) {
    const r = e.getBoundingClientRect();
    return { l: r.left - hr.left, t: r.top - hr.top, r: r.right - hr.left, b: r.bottom - hr.top, w: r.width, h: r.height };
  }
  const shown = e => {
    if (!e || e.hidden) return false;
    const cs = win.getComputedStyle(e);
    const op = cs.opacity === '' || cs.opacity == null ? 1 : +cs.opacity;
    return cs.display !== 'none' && cs.visibility !== 'hidden' && op > 0.05;
  };
  function place() {
    if (el.hidden) return;
    const hr = host.getBoundingClientRect();
    if (!hr.width || !hr.height) return;
    let l = 0, r = hr.width;
    for (const s of occSel) {
      const e = doc.querySelector(s);
      if (!shown(e)) continue;
      const q = rectIn(e, hr);
      if (q.r <= 1 || q.l >= hr.width - 1 || q.t > 120 || q.b < 0 || q.w > 0.6 * hr.width) continue;
      if (q.l <= 2) l = Math.max(l, q.r); else if (q.r >= hr.width - 2) r = Math.min(r, q.l);
    }
    const avoid = [];
    for (const s of avoidSel) for (const e of doc.querySelectorAll(s)) if (shown(e)) { const q = rectIn(e, hr); if (q.w && q.h) avoid.push(q); }
    // wait for lib/explode-bar.css (it sets --sn-xbar-css) and a real width
    if (!el.offsetWidth || !win.getComputedStyle(el).getPropertyValue('--sn-xbar-css').trim()) return;
    const p = placeBar({ host: { w: hr.width, h: hr.height }, bar: { w: el.offsetWidth, h: el.offsetHeight }, clear: { l, r }, avoid, phone: !!(phoneQ && phoneQ.matches) });
    el.style.left = Math.round(p.x) + 'px';
    el.style.top = Math.round(p.y) + 'px';
    el.style.visibility = '';
    el.classList.add('placed');
  }

  function onKey(e) {
    if (!key || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (String(e.key).toLowerCase() !== key) return;
    const t = e.target, tg = t && t.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || (t && t.isContentEditable)) return;
    if (el.hidden || inSaver(win, o.saver)) return;
    e.preventDefault();
    toggle();
  }
  win.addEventListener('keydown', onKey);

  let raf = 0, n = 0, dead = false;
  const loop = () => {
    if (dead) return;
    sync();
    if (n++ % 15 === 0) place();
    raf = win.requestAnimationFrame ? win.requestAnimationFrame(loop) : 0;
  };
  const onResize = () => place();
  win.addEventListener('resize', onResize);
  sync();
  loop();

  return {
    el, toggle, sync, place,
    destroy() { dead = true; if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf); win.removeEventListener('keydown', onKey); win.removeEventListener('resize', onResize); el.remove(); },
  };
}
