// ============================================================================
//  HOME · Observatory  —  page script (classic script, no ES modules)
// ----------------------------------------------------------------------------
//  Builds the rails, the star chart and the phone sector cards from
//  sectors.js, and runs the hero sky on one Canvas 2D context.
//
//  Classic scripts let the page run from file:// (a Finder double-click).
//  Browsers block ES modules there. Load order, all with defer:
//    thumbs/list.js -> ../../lib/nav-data.js -> sectors.js -> sky-data.js ->
//    commit-data.js -> main.js
//  They share one namespace object: window.Observatory.
//
//  Search is inline (initFind): a field in the hero and one in the dock,
//  each with a results list under it. There is no overlay, scrim or blur.
//  The user removed the old full-screen palette because it blurred the page.
//  The directory filter (#dirFilter) also filters in place.
//
//  grep -n targets
//    routing .............. "function routeClick"
//    page href / file:// .. "function pageHref"
//    thumbnails / art ..... "function media"
//    page card ............ "function cardHTML"
//    hero sky ............. "function startSky"
//    commit heatmap ....... "function buildCommits"
//    featured rail ........ "function buildFeatured"
//    star chart ........... "function buildChart"
//    inspector ............ "function renderInspector"
//    phone sectors ........ "function buildSectors"
//    dock ................. "function initDock"
//    search index ......... "const FIND_ITEMS"
//    search ranking ....... "function findResults"
//    inline search ........ "function initFind"
//    hero search text ..... "const FIND_TEXT"
//    social links ......... "YOUTUBE_URL"
//    directory filter ..... "function initDirectory"
//    directory columns .... "function balanceDirectory"
//    video facade ......... "function initVideo"
//    bug form ............. "function initBugForm"
//    screensaver key ...... "function initSaverKey"
//    reveal on scroll ..... "function initReveal"
//    portal spotlight ..... "function initSpot"
//
//  GPU budget: one Canvas 2D sky in the hero. It stops when the hero leaves
//  the view or the tab hides, and it frees its backing store on pagehide.
//  Everything else is DOM, CSS and SVG.
// ============================================================================
(function (O) {
'use strict';
const { SECTORS, REGION_BANDS, LAYOUT, GAME_STARS, BLURBS, THUMBS, FEATURED, allPages, searchPages } = O;

document.documentElement.classList.add('js');
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const HOVER = matchMedia('(hover: hover) and (pointer: fine)');
const PHONE = matchMedia('(max-width: 759px)');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The YouTube button target: the davesgames.io channel. Every
// [data-youtube] link takes its href from here. Without JS those links
// fall back to #media, the trailer and channel videos on this page.
const YOUTUBE_URL = 'https://www.youtube.com/@davesgamesio';
$$('a[data-youtube]').forEach(a => { a.href = YOUTUBE_URL; a.target = '_blank'; a.rel = 'noopener'; });

const PAGES = allPages();
const SECTOR = Object.fromEntries(SECTORS.map(s => [s.id, s]));
const UNIQUE = [...new Map(PAGES.map(p => [p.key, p])).values()];
$$('.page-count').forEach(el => { el.textContent = UNIQUE.length; });
$$('.con-count').forEach(el => { el.textContent = SECTORS.length; });
// The hero search text gives the number of searchable pages, rounded down
// to ten ("200+" for 207), so it stays true as pages land. index.html has
// the same text for no-JS readers. It is set again when the window crosses
// the phone width.
const FIND_COUNT = searchPages().length;
const FIND_TEXT = 'Search ' + Math.floor(FIND_COUNT / 10) * 10 + '+ pages';
const setFindText = () => $('.find-hero input').forEach(el => { el.placeholder = PHONE.matches ? FIND_TEXT : FIND_TEXT + ': black hole, chord, fire, orbit'; });
setFindText();
PHONE.addEventListener('change', setFindText);

// ── routing ────────────────────────────────────────────────────────────────
// A page link is <a href="/stella-nova/#key" target="_top" data-key>. Inside
// the shell, ask the shell to swap the tab. Outside it, let the link go.
// Modifier clicks keep the browser default, so "open in new tab" works.
function inShell() {
  try { return window.parent !== window && typeof window.parent.switchTab === 'function'; } catch (e) { return false; }
}
// On file:// a root-relative href points at the disk root. Outside the
// shell on file://, page links go to the live site. On http(s) they stay
// relative, so the preview server and the live site both work.
const LIVE = 'https://davesgames.io';
const OFFLINE = location.protocol === 'file:' && !inShell();
function pageHref(key) { return (OFFLINE ? LIVE : '') + '/stella-nova/#' + key; }
if (OFFLINE) $$('a[data-key]').forEach(a => { a.href = pageHref(a.dataset.key); });
function routeClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[data-key]');
  if (!a || !inShell()) return;
  e.preventDefault();
  window.parent.switchTab(a.dataset.key);
}
document.addEventListener('click', routeClick);

// ── thumbnails and generated art ──────────────────────────────────────────
// Return the visual for one page: its thumbnail, or a typographic plate
// in the sector color when no thumbnail exists.
function initials(label) {
  const w = label.replace(/[()&:]/g, ' ').split(/[\s–-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function media(p, img) {
  const src = img || (THUMBS.has(p.key) ? `thumbs/${p.key}.jpg` : null);
  if (src) return `<img src="${src}" alt="" loading="lazy" decoding="async">`;
  const h = hash(p.key || p.label);
  return `<span class="art" style="--ax:${20 + h % 60}%;--ay:${15 + (h >> 8) % 50}%"><b>${esc(initials(p.label))}</b><i>${esc(p.badge || p.group || '')}</i></span>`;
}
// The link attributes for a page record or an in-page/external star.
function linkAttrs(p) {
  if (p.href) return p.ext ? `href="${p.href}" target="_blank" rel="noopener"` : `href="${p.href}"`;
  return `href="${pageHref(p.key)}" target="_top" data-key="${p.key}"`;
}

// ── page card ──────────────────────────────────────────────────────────────
function cardHTML(p, i = 0, inSector = false) {
  const s = p.sector;
  const line = BLURBS[p.key] || p.sub || p.group;
  return `<a class="card" data-sector="${s.id}" ${linkAttrs(p)} style="--i:${i}">
    <span class="card-img">${media(p, p.img)}${p.badge ? `<span class="card-badge">${esc(p.badge)}</span>` : ''}</span>
    <span class="card-body"><span class="card-sec">${inSector ? esc(p.group) : esc(s.short) + (p.group && p.group !== s.name ? ' · ' + esc(p.group) : '')}</span>
    <span class="card-title">${esc(p.label)}</span><span class="card-line">${esc(line)}</span></span></a>`;
}

// Fill the static portal images from the thumbnail set.
$$('img[data-thumb]').forEach(img => {
  const k = img.dataset.thumb;
  if (THUMBS.has(k)) img.src = `thumbs/${k}.jpg`;
  else { const p = UNIQUE.find(x => x.key === k); img.insertAdjacentHTML('afterend', media(p)); img.remove(); }
});
$$('.title .t-row > span').forEach((el, i) => el.style.setProperty('--i', i));
// When the last letter lands, drop the intro animation so no transform or
// layer stays on the glyphs (Safari kept them soft). The timeout covers an
// interrupted or skipped animation.
(() => {
  const title = $('.title'), last = $$('.title .t-row > span').pop();
  if (!title || !last) return;
  const done = () => title.classList.add('intro-done');
  last.addEventListener('animationend', done, { once: true });
  setTimeout(done, 2600);
})();
$$('.portal').forEach((el, i) => el.style.setProperty('--i', i));

// ── hero sky ───────────────────────────────────────────────────────────────
// The hero background is a quiet sky of real objects (sky-data.js):
//   canvas #sky   nebula, faint field stars, the bright stars by RA/Dec,
//                 M31 and Sgr A*. Painted once per resize, no frame loop.
//   svg .orrery   the orbits of Mercury to Jupiter, seen top-down: thin 1 px
//                 circles centred on the title block, so the planets orbit
//                 the words. The rings and planets sit under the veil and
//                 behind all hero content.
//   .sky-layer    one small anchor per object: planets, Moon, satellites,
//                 bright stars and the deep-sky objects. Hover, focus or a
//                 first tap shows its label. Linked objects open their page.
// Motion: planets move on Kepler periods (one Earth year = 240 s, so inner
// planets run faster), the Moon circles Earth, and the satellites cross the
// sky at a rate set by their mean motion. The loop moves DOM transforms only
// at about 30 fps. It stops when the hero is off screen or the tab hides,
// and on pagehide it frees the canvas backing store.
function startSky() {
  const cv = $('#sky'), hero = $('.hero'), bg = $('.hero-bg');
  const SKY = O.SKY;
  if (!cv || !cv.getContext || !SKY) return;
  const ctx = cv.getContext('2d', { alpha: false });
  const NS = 'http://www.w3.org/2000/svg';
  const YEAR = 240;               // seconds for one Earth orbit
  const RA0 = 23;                 // RA (h) at the left edge
  const rand = mulberry(7);
  let W = 0, H = 0, dpr = 1, raf = 0, running = false, visible = true, last = 0;
  const t0 = performance.now() - 37000;

  // Orbit rings (SVG) and the object layer (DOM).
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'orrery');
  const veil = $('.hero-veil', bg);
  bg.insertBefore(svg, veil);
  const layer = document.createElement('div');
  layer.className = 'sky-layer';
  bg.insertBefore(layer, veil);

  // One object element. A page key makes it a real link.
  function obj(label, key, cls, size, color) {
    const el = document.createElement(key ? 'a' : 'span');
    el.className = 'sky-obj ' + cls;
    const page = key && (UNIQUE.find(p => p.key === key) || {}).label;
    el.dataset.label = page ? `${label}  →  ${page}` : label;
    el.setAttribute('aria-label', page ? `${label}, open ${page}` : label);
    if (key) { el.href = pageHref(key); el.target = '_top'; el.dataset.key = key; }
    else { el.tabIndex = 0; el.setAttribute('role', 'img'); }
    el.style.setProperty('--s', size + 'px');
    if (color) el.style.setProperty('--col', color);
    layer.appendChild(el);
    return el;
  }
  // B-V color index to a star color (blue-white to orange-red).
  function bvColor(bv) {
    const k = Math.max(0, Math.min(1, (bv + 0.2) / 2.0));
    const r = Math.round(170 + 85 * Math.min(1, k * 1.8)), g = Math.round(200 + 30 * (1 - Math.abs(k - 0.35) * 2)), b = Math.round(255 - 150 * k);
    return `rgb(${r},${Math.max(140, Math.min(235, g))},${Math.max(100, b)})`;
  }
  // Equirectangular sky, RA left to right from RA0, Dec +55 to -35 over the
  // upper half of the hero, so the objects sit in the open space.
  const proj = (ra, dec) => [(((RA0 - ra) / 24) % 1 + 1) % 1, 0.04 + (55 - dec) / 90 * 0.46];

  const stars = SKY.stars.map(([n, ra, dec, mag, bv]) => ({ n, p: proj(ra, dec), mag, col: bvColor(bv),
    el: obj(`${n} · mag ${mag.toFixed(2)}`, null, 'star-real', 3 + Math.max(0, 1.4 - mag * 0.7), bvColor(bv)) }));
  const deep = SKY.deep.map(([n, ra, dec, kind, key]) => ({ n, kind, p: proj(ra, dec), el: obj(n, key, 'deep ' + kind, 5) }));
  const sun = obj(SKY.sun[0], SKY.sun[1], 'sun', 6);
  const planets = SKY.planets.map(([n, a, P, r, key]) => ({ n, a, P, ph: rand() * 6.283, el: obj(n, key, 'planet', r * 2) }));
  const earth = planets.find(p => p.n === 'Earth');
  const moon = { P: SKY.moon[1], rr: SKY.moon[2], el: obj(SKY.moon[0], SKY.moon[3], 'moon', 3) };
  const sats = SKY.sats.map(([n, inc, raan, ma, mm]) => ({ n, inc, raan, ma, mm,
    el: obj(`${n} · ${inc.toFixed(1)}° · ${mm.toFixed(2)} rev/day`, 'leo', 'sat', 2.5) }));

  let geo = null;
  function layout() {
    const r = hero.getBoundingClientRect();
    W = r.width; H = r.height;
    const phone = W < 760;
    // Top-down view: every orbit is a circle round the Sun. The Sun is on
    // the centre line of the page, so the rings stay centred on the hero.
    // The word gap is not on that line (STELLA is wider than NOVA), so the
    // Sun sits in open space: under the title, above the tagline. The title
    // line box ends below the letters (line-height 0.92 with descent), so its
    // bottom edge is the middle of the visible gap. When the rows stack
    // (phones), the Sun sits between the rows.
    const hr = hero.getBoundingClientRect();
    const [r1, r2] = $$('.title .t-row', hero).map(e => e.getBoundingClientRect());
    const cx = W / 2;
    let cy = H * 0.3;
    if (r1 && r2) {
      const oneLine = r2.top < r1.bottom - 4;
      cy = (oneLine ? Math.max(r1.bottom, r2.bottom) : (r1.bottom + r2.top) / 2) - hr.top;
    }
    const R = phone ? W * 0.7 : Math.min(W * 0.46, H * 0.62, 640);
    geo = { cx, cy, R };
    // Orbit radii follow sqrt(a), so the inner planets stay readable.
    planets.forEach(p => { p.rr = R * Math.sqrt(p.a / 5.203); });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = planets.map(p => `<circle cx="${geo.cx.toFixed(1)}" cy="${geo.cy.toFixed(1)}" r="${p.rr.toFixed(1)}"/>`).join('');
    place(sun, geo.cx, geo.cy);
    // A fixed object that falls behind the title or the statement is drawn
    // faint and gets no hit area, so no dot sits inside a letter.
    const boxes = $$('.eyebrow, .title .t-row, .tagline, .statement').map(e => e.getBoundingClientRect())
      .map(b => [b.left - hr.left - 10, b.top - hr.top - 8, b.right - hr.left + 10, b.bottom - hr.top + 8]);
    const covered = (x, y) => boxes.some(b => x > b[0] && x < b[2] && y > b[1] && y < b[3]);
    [...stars, ...deep].forEach(o => {
      const x = o.p[0] * W, y = o.p[1] * H;
      o.covered = covered(x, y); o.el.hidden = o.covered;
      place(o.el, x, y);
    });
  }
  function place(el, x, y) { el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; el._x = x; el._y = y; }

  // Labels: one element per shown object, in a top layer above the hero
  // content. Each label tries above, below, right and left of its object,
  // kept inside the hero, and takes the first spot that covers no button,
  // link or field. A moving object carries its label with it.
  const tips = document.createElement('div');
  tips.className = 'sky-tips';
  hero.appendChild(tips);
  const shown = new Map();
  function obstacles() {
    const hr = hero.getBoundingClientRect();
    return $$('.hero-inner a, .hero-inner button, .hero-inner input, .hero-inner .find-field, .scroll-cue', hero)
      .map(e => e.getBoundingClientRect()).filter(b => b.width && b.height)
      .map(b => [b.left - hr.left - 4, b.top - hr.top - 4, b.right - hr.left + 4, b.bottom - hr.top + 4]);
  }
  function placeTip(el, tip, obs) {
    const w = tip.offsetWidth, h = tip.offsetHeight, x = el._x, y = el._y, g = 14;
    const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
    const spots = [[x - w / 2, y - g - h], [x - w / 2, y + g], [x + g, y - h / 2], [x - g - w, y - h / 2],
      [x + g, y - g - h], [x - g - w, y - g - h], [x + g, y + g], [x - g - w, y + g]]
      .map(([a, b]) => [clamp(a, 8, W - 8 - w), clamp(b, 8, H - 8 - h)]);
    const free = ([a, b]) => !obs.some(o => a < o[2] && a + w > o[0] && b < o[3] && b + h > o[1]);
    let best = spots.find(free);
    if (!best) {
      // Slide up from the object until the label clears every obstacle.
      for (let dy = g; dy < H && !best; dy += 8) for (const c of [[x - w / 2, y - dy - h], [x - w / 2, y + dy]]) { const k = [clamp(c[0], 8, W - 8 - w), clamp(c[1], 8, H - 8 - h)]; if (!best && free(k)) best = k; }
    }
    best = best || spots[0];
    tip.style.transform = `translate(${best[0].toFixed(1)}px, ${best[1].toFixed(1)}px)`;
    obs.push([best[0] - 3, best[1] - 3, best[0] + w + 3, best[1] + h + 3]);  // later labels avoid this one
  }
  function refreshTips() {
    const want = new Set($$('.sky-obj', layer).filter(e => !e.hidden && (e.matches(':hover') || e === document.activeElement || e.classList.contains('show'))));
    for (const [el, tip] of shown) if (!want.has(el)) { tip.remove(); shown.delete(el); }
    if (!want.size) return;
    const obs = obstacles();
    for (const el of want) {
      let tip = shown.get(el);
      if (!tip) { tip = document.createElement('span'); tip.className = 'sky-tip'; tip.textContent = el.dataset.label; tip.setAttribute('aria-hidden', 'true'); tips.appendChild(tip); shown.set(el, tip); }
      placeTip(el, tip, obs);
    }
  }
  layer.addEventListener('pointerover', refreshTips);
  layer.addEventListener('pointerout', () => requestAnimationFrame(refreshTips));
  layer.addEventListener('focusin', refreshTips);
  layer.addEventListener('focusout', () => requestAnimationFrame(refreshTips));
  new MutationObserver(refreshTips).observe(layer, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Canvas: nebula, field stars, real stars and deep-sky objects. Static.
  function paint() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
    const rr = mulberry(11);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, rad, col, a] of [[0.18, 0.30, 0.55, '70,110,200', 0.20], [0.82, 0.24, 0.50, '120,80,190', 0.17], [0.60, 0.72, 0.60, '229,139,208', 0.07], [0.30, 0.80, 0.45, '60,170,200', 0.09]]) {
      for (let k = 0; k < 5; k++) {
        const cx = (x + (rr() - 0.5) * 0.16) * W, cy = (y + (rr() - 0.5) * 0.16) * H;
        const rad2 = rad * Math.max(W, H) * (0.4 + rr() * 0.4);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad2);
        g.addColorStop(0, `rgba(${col},${a * (0.5 + rr() * 0.5)})`); g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Field stars: faint, small, no glow.
    const n = Math.min(420, Math.round(W * H / 3600));
    for (let i = 0; i < n; i++) {
      const a = 0.12 + rr() * 0.45, s = rr() < 0.9 ? 0.8 : 1.3;
      ctx.fillStyle = `rgba(225,235,255,${a.toFixed(2)})`;
      ctx.fillRect(rr() * W, rr() * H, s, s);
    }
    // Bright stars: a dot sized by magnitude, colored by B-V.
    for (const s of stars) {
      const x = s.p[0] * W, y = s.p[1] * H, r = Math.max(0.9, 2.1 - s.mag * 0.45);
      if (s.covered) continue;
      ctx.globalAlpha = 0.85; ctx.fillStyle = s.col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // M31: a small tilted ellipse. Sgr A*: a thin ring round a dark core.
    for (const d of deep) {
      const x = d.p[0] * W, y = d.p[1] * H;
      if (d.covered) continue;
      if (d.kind === 'galaxy') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
        g.addColorStop(0, 'rgba(255,236,200,.55)'); g.addColorStop(0.35, 'rgba(220,200,255,.16)'); g.addColorStop(1, 'rgba(200,190,255,0)');
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.6); ctx.scale(1, 0.32); ctx.translate(-x, -y);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.283); ctx.fill(); ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(255,190,90,.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, y, 5, 2, 0, 0, 6.283); ctx.stroke();
        ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.283); ctx.fill();
      }
    }
  }

  // Moving objects at time t (s).
  function step(t) {
    const { cx, cy } = geo;
    for (const p of planets) {
      const th = p.ph + 6.2832 * t / (p.P * YEAR);
      p.x = cx + p.rr * Math.cos(th); p.y = cy + p.rr * Math.sin(th);
      place(p.el, p.x, p.y);
    }
    const mt = 6.2832 * t / (moon.P * YEAR * 3);   // Moon slowed 3x to stay calm
    place(moon.el, earth.x + moon.rr * Math.cos(mt), earth.y + moon.rr * Math.sin(mt));
    // Satellites cross a low band of the hero, under the content. The track phase comes
    // from the mean anomaly and RAAN, the wave height from the inclination,
    // and the speed from the mean motion (one crossing per ~3 minutes).
    for (const s of sats) {
      const u = ((s.ma / 360 + t * s.mm / 15.5 / 180) % 1 + 1) % 1;
      const x = -20 + u * (W + 40);
      const y = H * (0.86 + 0.08 * (s.raan / 360)) + H * 0.025 * (s.inc / 98) * Math.sin(u * 6.2832 + s.raan * 0.0175);
      place(s.el, x, y);
    }
    if (shown.size) refreshTips();
  }

  function frame(now) {
    raf = 0; if (!running) return;
    if (now - last > 33) { last = now; step((now - t0) / 1000); }
    raf = requestAnimationFrame(frame);
  }
  function setRun() {
    const want = visible && !document.hidden && !RM.matches;
    if (want && !running) { running = true; raf = requestAnimationFrame(frame); }
    else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }
  function build() { layout(); paint(); step((performance.now() - t0) / 1000); }

  // Touch: the first tap on an object shows its label; a second tap opens it.
  layer.addEventListener('click', e => {
    const el = e.target.closest('.sky-obj');
    if (!el) return;
    if (!el.classList.contains('show') && !HOVER.matches) {
      e.preventDefault();
      $$('.sky-obj.show', layer).forEach(x => x.classList.remove('show'));
      el.classList.add('show');
    }
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.sky-obj')) $$('.sky-obj.show', layer).forEach(x => x.classList.remove('show')); });

  build();
  // Web fonts change the text boxes, so lay out again once they load.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(build, 150); });
  new IntersectionObserver(es => { visible = es[0].isIntersecting; setRun(); }, { threshold: 0 }).observe(hero);
  document.addEventListener('visibilitychange', setRun);
  RM.addEventListener?.('change', setRun);
  addEventListener('pagehide', () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; cv.width = cv.height = 0; });
  addEventListener('pageshow', e => { if (e.persisted) { build(); setRun(); } });
  setRun();
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ── featured rail ──────────────────────────────────────────────────────────
function buildFeatured() {
  const rail = $('#featuredRail');
  rail.innerHTML = FEATURED.map(k => UNIQUE.find(p => p.key === k)).filter(Boolean).map((p, i) => cardHTML(p, i)).join('');
}
function initRails() {
  $$('[data-rail]').forEach(b => b.addEventListener('click', () => {
    const r = document.getElementById(b.dataset.rail);
    r.scrollBy({ left: Number(b.dataset.dir) * r.clientWidth * 0.8, behavior: RM.matches ? 'auto' : 'smooth' });
  }));
}

// ── sector page lists ──────────────────────────────────────────────────────
// For each sector: its groups in NAV order, each a list of star records.
function sectorGroups(sec) {
  const groups = [];
  const seen = new Set();
  for (const p of PAGES) {
    if (p.sector !== sec) continue;
    let g = groups.find(x => x.name === p.group && x.cluster === p.cluster);
    if (!g) { g = { name: p.group, cluster: p.cluster, pages: [] }; groups.push(g); }
    if (!seen.has(p.key)) { g.pages.push(p); seen.add(p.key); }
  }
  if (sec.id === 'game') {
    const extra = GAME_STARS.map(s => ({ ...s, key: null, badge: s.ext ? 'LINK' : null, group: 'Stella Nova', sector: sec }));
    groups[0].pages = [...extra.slice(0, 4), ...groups[0].pages, ...extra.slice(4)];
  }
  return groups;
}
const GAME_IMG = { '#features': 'media/game-3.jpg', '#media': 'media/game-2.jpg', '#download': 'media/game-1.jpg', '#report': 'media/game-5.jpg', home: 'media/game-6.jpg' };
function withImg(p) { const img = GAME_IMG[p.href || p.key]; return img ? { ...p, img } : p; }

// ── star chart ─────────────────────────────────────────────────────────────
let chartState = null;
function buildChart() {
  const svg = $('#chartSvg'), starsEl = $('#chartStars'), map = $('#chartMap');
  const NS = 'http://www.w3.org/2000/svg';
  const rand = mulberry(42);
  let svgHTML = '';
  // Sky grid: meridians, parallels, an ecliptic and edge ticks.
  let grid = '<g class="grid">';
  for (let i = 1; i < 6; i++) { const x = i * 1000 / 6; grid += `<path d="M${x} 0 Q ${x + (x - 500) * 0.18} 310 ${x} 620"/>`; }
  for (let j = 1; j < 4; j++) { const y = j * 620 / 4; grid += `<path d="M0 ${y} Q 500 ${y + (y - 310) * 0.25} 1000 ${y}"/>`; }
  grid += '<path class="ecl" d="M0 420 C 250 300, 520 520, 1000 250"/>';
  for (let i = 0; i < 6; i++) grid += `<text x="${i * 1000 / 6 + 6}" y="14">${String(i * 4).padStart(2, '0')}h</text>`;
  for (let j = 1; j < 4; j++) grid += `<text x="6" y="${j * 155 - 5}">${['+60', '+30', '0', '-30'][j]}°</text>`;
  grid += '</g>';
  // Faint background stars.
  let bg = '<g>';
  for (let i = 0; i < 220; i++) bg += `<circle class="bg-star" cx="${(rand() * 1000).toFixed(1)}" cy="${(rand() * 620).toFixed(1)}" r="${(0.3 + rand() * 0.9).toFixed(2)}" opacity="${(0.15 + rand() * 0.5).toFixed(2)}"/>`;
  bg += '</g>';
  // Region bands: the region name and the edge of its band (SN_NAV regions).
  let bands = '<g class="regions">';
  REGION_BANDS.forEach(b => {
    bands += `<text class="rgn" x="${b.at[0]}" y="${b.at[1]}">${esc(b.name)}</text>`;
    if (b.edge) bands += `<path class="rgn-edge" d="${b.edge}"/>`;
  });
  bands += '</g>';
  svgHTML += grid + bg + bands;

  const allStars = [];
  let labelsHTML = '', starsHTML = '';
  SECTORS.forEach((sec, si) => {
    const groups = sectorGroups(sec);
    const anchors = LAYOUT[sec.id];
    const r = mulberry(100 + si * 17);
    const placed = [];
    let edges = [];
    groups.forEach((g, gi) => {
      const [cx, cy, rad] = anchors[gi] || anchors[anchors.length - 1];
      const pts = [];
      g.pages.forEach((p, pi) => {
        let best = null;
        if (g.pages.length === 1) best = [cx, cy];
        else {
          let bd = -1;
          for (let k = 0; k < 40; k++) {
            const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
            const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.78;
            let md = 1e9; for (const q of pts) md = Math.min(md, Math.hypot(q[0] - x, q[1] - y));
            if (pts.length === 0) md = 1e9 - d;
            if (md > bd) { bd = md; best = [x, y]; }
          }
        }
        pts.push(best);
        const s = { p, x: best[0], y: best[1], g: gi, sec };
        placed.push(s);
      });
      // Prim minimum spanning tree inside the group.
      const idx = placed.map((s, i) => i).filter(i => placed[i].g === gi);
      const inT = new Set([idx[0]]);
      while (inT.size < idx.length) {
        let bd = 1e9, e = null;
        for (const a of inT) for (const b of idx) if (!inT.has(b)) {
          const d = Math.hypot(placed[a].x - placed[b].x, placed[a].y - placed[b].y);
          if (d < bd) { bd = d; e = [a, b]; }
        }
        edges.push(e); inT.add(e[1]);
      }
      // Join the group to the nearest star of an earlier group.
      if (gi > 0) {
        let bd = 1e9, e = null;
        for (const a of idx) placed.forEach((s, b) => { if (s.g < gi) { const d = Math.hypot(placed[a].x - s.x, placed[a].y - s.y); if (d < bd) { bd = d; e = [b, a]; } } });
        if (e) edges.push(e);
      }
    });
    // Lines: one line per edge (for the draw-in).
    let lines = '';
    edges.forEach(([a, b], k) => {
      const A = placed[a], B = placed[b];
      const len = Math.hypot(A.x - B.x, A.y - B.y).toFixed(1);
      lines += `<line class="ln" x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" style="--len:${len};--d:${si * 180 + k * 40}"/>`;
    });
    // Clean diagram: thin even lines. No group names (the constellations are
    // small, and the inspector lists the pages), no glow path, no halo.
    svgHTML += `<g class="con" data-sector="${sec.id}">${lines}</g>`;
    // Stars as real anchors.
    placed.forEach((s, k) => {
      const p = s.p;
      const big = p.key === sec.lead || FEATURED.includes(p.key);
      const size = big ? 9 : THUMBS.has(p.key) ? 7 : 5;
      const tw = rand() < 0.35 ? ` data-tw style="--x:${s.x.toFixed(1)};--y:${s.y.toFixed(1)};--s:${size}px;--tw:${(3 + rand() * 4).toFixed(1)}s;--twd:${(-rand() * 5).toFixed(1)}s"` : ` style="--x:${s.x.toFixed(1)};--y:${s.y.toFixed(1)};--s:${size}px"`;
      starsHTML += `<a class="star${p.ext ? ' ext' : ''}" data-sector="${sec.id}" data-i="${allStars.length}" ${linkAttrs(p)} aria-label="${esc(p.label)}, ${esc(sec.name)}"${tw}><i></i></a>`;
      allStars.push(s);
    });
    labelsHTML += `<button class="c-label" type="button" data-sector="${sec.id}" style="--x:${sec.label[0]};--y:${sec.label[1]}"><span class="g">${sec.glyph}</span>${esc(sec.short)}<small>${placed.length}</small></button>`;
  });
  svg.innerHTML = svgHTML;
  starsEl.innerHTML = starsHTML + labelsHTML;

  const tip = $('#chartTip');
  const state = { active: null, pinned: false, touched: false, tour: 0 };
  chartState = state;
  function setActive(id, opts = {}) {
    if (opts.user) { state.touched = true; stopTour(); }
    if (state.active !== id) {
      state.active = id;
      $$('.con', svg).forEach(g => g.classList.toggle('on', g.dataset.sector === id));
      $$('.star', starsEl).forEach(a => a.classList.toggle('on', a.dataset.sector === id));
      $$('.c-label', starsEl).forEach(b => b.classList.toggle('on', b.dataset.sector === id));
      $$('.chip[data-goto]').forEach(c => c.classList.toggle('on', c.dataset.goto === id));
      renderInspector(SECTOR[id]);
    }
    map.classList.toggle('has-active', !!opts.dim);
  }
  state.setActive = setActive;
  // Pointer: the nearest star within reach picks the sector.
  map.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = map.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 1000, y = (e.clientY - r.top) / r.height * 620;
    let bd = 1e9, best = null;
    for (const s of allStars) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
    if (best && bd < 80) setActive(best.sec.id, { user: true, dim: true });
    else map.classList.remove('has-active');
  });
  map.addEventListener('pointerleave', () => map.classList.remove('has-active'));
  // Star tooltip with a thumbnail preview.
  function showTip(a) {
    const s = allStars[Number(a.dataset.i)];
    const p = withImg(s.p);
    tip.dataset.sector = s.sec.id;
    tip.innerHTML = `<div class="tip-img">${media(p, p.img)}</div><div class="tip-body"><b>${esc(p.label)}</b><span>${esc(s.sec.short)} · ${esc(p.badge || p.group || '')}</span></div>`;
    tip.hidden = false;
    const W = map.clientWidth, H = map.clientHeight;
    const px = s.x / 1000 * W, py = s.y / 620 * H;
    const tw = 210, th = tip.offsetHeight || 190;
    let left = px + 18, top = py - th / 2;
    if (left + tw > W - 8) left = px - tw - 18;
    top = Math.max(8, Math.min(H - th - 8, top));
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  starsEl.addEventListener('pointerover', e => { const a = e.target.closest('.star'); if (a && e.pointerType === 'mouse') showTip(a); });
  starsEl.addEventListener('pointerout', e => { if (e.target.closest('.star')) tip.hidden = true; });
  starsEl.addEventListener('focusin', e => {
    const a = e.target.closest('.star'); const b = e.target.closest('.c-label');
    if (a) { showTip(a); setActive(a.dataset.sector, { user: true, dim: true }); }
    if (b) setActive(b.dataset.sector, { user: true, dim: true });
  });
  starsEl.addEventListener('focusout', () => { tip.hidden = true; });
  starsEl.addEventListener('click', e => { const b = e.target.closest('.c-label'); if (b) setActive(b.dataset.sector, { user: true, dim: true }); });
  // Auto tour: light one constellation after another until the user acts.
  const order = SECTORS.map(s => s.id);
  function stopTour() { clearInterval(state.tour); state.tour = 0; }
  function startTour() {
    if (state.touched || RM.matches || state.tour) return;
    state.tour = setInterval(() => {
      if (document.hidden) return;
      const i = (order.indexOf(state.active) + 1) % order.length;
      setActive(order[i], { dim: true });
    }, 4200);
  }
  setActive('game');
  new IntersectionObserver(es => {
    es.forEach(en => {
      if (en.isIntersecting) { map.classList.add('drawn'); startTour(); }
      else stopTour();
    });
  }, { threshold: 0.35 }).observe(map);
}

// ── inspector ──────────────────────────────────────────────────────────────
function renderInspector(sec) {
  const ins = $('#inspector');
  ins.dataset.sector = sec.id;
  const groups = sectorGroups(sec);
  const pages = groups.flatMap(g => g.pages);
  const lead = pages.find(p => p.key === sec.lead || p.href === '#' + sec.lead) || pages[0];
  const withThumb = pages.filter(p => p !== lead && (THUMBS.has(p.key) || GAME_IMG[p.href || p.key]));
  const rest = pages.filter(p => p !== lead && !withThumb.includes(p));
  const minis = [lead, ...withThumb, ...rest].slice(0, 4).map(withImg);
  const n = pages.filter(p => p.key).length;
  ins.innerHTML = `<div class="ins-in">
    <div class="ins-head"><span class="ins-g">${sec.glyph}</span><div><h3>${esc(sec.name)}</h3><small>${n} page${n === 1 ? '' : 's'}${groups.length > 1 ? ' · ' + groups.length + ' asterisms' : ''}</small></div></div>
    <p class="ins-blurb">${esc(sec.blurb)}</p>
    <div class="ins-grid">${minis.map((p, i) => `<a class="mini" ${linkAttrs(p)} style="--i:${i}"><span class="card-img">${media(p, p.img)}</span><span class="mini-t">${esc(p.label)}</span></a>`).join('')}</div>
    <div class="ins-list">${pages.map(p => `<a class="pill${p.ext ? ' ext' : ''}" ${linkAttrs(p)}>${esc(p.label)}</a>`).join('')}</div>
    <a class="ins-cta" ${linkAttrs(lead)}><span>Open ${esc(lead.label)}</span><span aria-hidden="true">→</span></a>
  </div>`;
}

// ── phone sector cards ─────────────────────────────────────────────────────
function buildSectors() {
  const host = $('#sectors');
  host.innerHTML = `<div class="band-head"><div><p class="kicker">// Star chart &middot; ${UNIQUE.length} pages</p><h2>Pick a <em>heading</em></h2></div></div>` +
    SECTORS.map(sec => {
      const pages = sectorGroups(sec).flatMap(g => g.pages).map(withImg);
      const n = pages.filter(p => p.key).length;
      return `<article class="sector" id="sec-${sec.id}" data-sector="${sec.id}">
        <div class="sector-head"><span class="ins-g">${sec.glyph}</span><div><h3>${esc(sec.name)}</h3><small>${sec.id === 'game' ? pages.length + ' destinations' : n + ' page' + (n === 1 ? '' : 's')} · swipe →</small></div></div>
        <p class="sector-blurb">${esc(sec.blurb)}</p>
        <div class="rail">${pages.map((p, i) => cardHTML(p, i, true)).join('')}</div>
      </article>`;
    }).join('');
}

// ── dock ───────────────────────────────────────────────────────────────────
function initDock() {
  $$('.chip[data-goto]').forEach(c => c.addEventListener('click', e => {
    e.preventDefault();
    const id = c.dataset.goto;
    const target = PHONE.matches ? $('#sec-' + id) : $('#chart');
    if (!PHONE.matches && chartState) chartState.setActive(id, { user: true, dim: false });
    target.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'start' });
    c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }));
  // Scroll spy: the game chip lights over the game bands.
  const game = $('.chip[data-sector="game"]');
  const all = $('.chip-all');
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (en.target.id === 'features' || en.target.id === 'download' || en.target.id === 'report') game.classList.toggle('on', en.isIntersecting);
    if (en.target.id === 'directory') all.classList.toggle('on', en.isIntersecting);
  }), { rootMargin: '-40% 0px -50% 0px' });
  ['features', 'download', 'report', 'directory'].forEach(id => io.observe(document.getElementById(id)));
}

// ── inline search ──────────────────────────────────────────────────────────
// Each [data-find] block is a field with a results list under it. Typing
// ranks pages by label, group, sector, blurb and credit. Arrow keys move,
// Enter opens, Esc or a click outside closes. "/" focuses the nearest field.
// No overlay and no scrim: the rest of the page stays sharp and usable.
//
// FIND_ITEMS holds every page of searchPages() (sectors.js): all registered
// pages except DIRECTORY_ONLY, so also the EXCLUDED ports, which the rest
// of the home does not show. The game sector stars come first. A port
// carries the word "port" and its credit line (CREDITS) in its search
// text, and the result row shows the credit. fold() drops accents, so
// "muller" finds "Müller".
const fold = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const FIND_ITEMS = (() => {
  const items = [];
  const add = (p, sec) => {
    if (p.key && items.some(x => x.key === p.key)) return;
    const it = withImg(p);
    it.hay = fold([p.label, p.group, p.cluster, p.badge, sec.name, BLURBS[p.key], p.sub, p.key, p.credit, p.port ? 'port' : ''].filter(Boolean).join(' '));
    items.push(it);
  };
  SECTORS.forEach(sec => sectorGroups(sec).forEach(g => g.pages.forEach(p => add(p, sec))));
  searchPages().forEach(p => add(p, p.sector));
  return items;
})();
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hl(text, terms) {
  let out = esc(text);
  for (const t of terms) if (t) out = out.replace(new RegExp('(' + reEsc(esc(t)) + ')', 'ig'), '<mark>$1</mark>');
  return out;
}
function findResults(q) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return { terms, res: FEATURED.slice(0, 6).map(k => FIND_ITEMS.find(x => x.key === k)).filter(Boolean), total: 0 };
  const res = FIND_ITEMS.filter(it => terms.every(t => it.hay.includes(t)))
    .map(it => { const l = fold(it.label); return { it, sc: l.startsWith(terms[0]) ? 0 : l.includes(terms[0]) ? 1 : 2 }; })
    .sort((a, b) => a.sc - b.sc).map(x => x.it);
  return { terms, res: res.slice(0, 8), total: res.length };
}
// For tests (pages/home/tests.mjs): the search index and its ranking.
O.find = { FIND_ITEMS, findResults, FIND_TEXT };
function initFind(root) {
  const input = $('input', root), list = $('.find-list', root);
  let sel = -1;
  const items = () => $$('.find-item', list);
  function mark(n) {
    const els = items(); if (!els.length) return;
    els[sel]?.classList.remove('sel');
    sel = (n + els.length) % els.length;
    els[sel].classList.add('sel');
    els[sel].scrollIntoView({ block: 'nearest' });
  }
  function render() {
    const q = input.value.trim();
    const { terms, res, total } = findResults(q);
    sel = -1;
    let html = q ? '' : '<p class="find-h">Popular</p>';
    if (!res.length) html += `<p class="find-empty">No page matches "${esc(q)}". Try orbit, fluid, shader or chord.</p>`;
    html += res.map((it, i) => `<a class="find-item" role="option" data-sector="${it.sector.id}" data-n="${i}" ${linkAttrs(it)}>
      <span class="fi-img">${media(it, it.img)}</span>
      <span class="fi-t"><b>${hl(it.label, terms)}</b><small>${esc(it.sector.short)} · ${it.credit ? hl(it.credit, terms) + ' · ' : ''}${hl(BLURBS[it.key] || it.sub || it.group || '', terms)}</small></span>
      ${it.badge ? `<span class="badge">${esc(it.badge)}</span>` : ''}<span class="fi-go" aria-hidden="true">→</span></a>`).join('');
    if (q && total > res.length) html += `<a class="find-more" href="#directory" data-find-all>See all ${total} matches in the directory <span aria-hidden="true">→</span></a>`;
    list.innerHTML = html;
    open();
  }
  function open() { list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; }
  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); mark(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(sel - 1); }
    else if (e.key === 'Enter') { const a = items()[sel < 0 ? 0 : sel]; if (a) { e.preventDefault(); a.click(); close(); } }
    else if (e.key === 'Escape') { if (input.value && list.hidden) input.value = ''; close(); input.blur(); }
  });
  // Keep the focus in the field when a result is pressed. Safari and Firefox
  // on macOS do not focus a link on a click, so the field blurred with no
  // relatedTarget, focusout closed the list before mouseup, and the click
  // fell on nothing. Chrome focuses the link, so it did not show there.
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('pointermove', e => {
    const a = e.target.closest('.find-item'); if (!a) return;
    const n = Number(a.dataset.n); if (n !== sel) { items()[sel]?.classList.remove('sel'); sel = n; a.classList.add('sel'); }
  });
  list.addEventListener('click', e => {
    const all = e.target.closest('[data-find-all]');
    if (all) { const f = $('#dirFilter'); f.value = input.value; f.dispatchEvent(new Event('input')); }
    if (e.target.closest('a')) close();
  });
  document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); });
  root.addEventListener('focusout', e => { if (!root.contains(e.relatedTarget)) setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 0); });
}
// "/" focuses a search field: the hero field while the hero is in view,
// else the dock field. It never fires while the user types in a field.
function initFindKey() {
  const hero = $('.find-hero input'), dock = $('.find-dock input'), heroEl = $('.hero');
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    const r = heroEl.getBoundingClientRect();
    const target = r.bottom > innerHeight * 0.45 && getComputedStyle(hero).display !== 'none' ? hero : dock;
    target.focus({ preventScroll: target === dock });
  });
}

// ── directory filter ───────────────────────────────────────────────────────
function initDirectory() {
  const input = $('#dirFilter'), groups = $$('.dir-group'), empty = $('#dirEmpty');
  if (PHONE.matches) groups.forEach(g => { g.open = false; });
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let any = false;
    groups.forEach(g => {
      let n = 0;
      $$('li', g).forEach(li => {
        const h = li.closest('ul').previousElementSibling;
        const text = (li.textContent + ' ' + (h && h.classList.contains('dir-h') ? h.textContent : '') + ' ' + $('.dir-name', g).textContent).toLowerCase();
        const ok = !q || text.includes(q); li.hidden = !ok; if (ok) n++;
      });
      $$('.dir-h', g).forEach(h => { h.hidden = !!q && !$$('li:not([hidden])', h.nextElementSibling).length; });
      g.hidden = n === 0; if (q && n) g.open = true; if (n) any = true;
    });
    empty.hidden = any;
    balanceDirectory();
  });
  // A group that opens or closes changes its height, so balance again.
  $('#dirList').addEventListener('toggle', () => balanceDirectory(), true);
  let w = 0;
  new ResizeObserver(([e]) => { const nw = Math.round(e.contentRect.width); if (nw !== w) { w = nw; balanceDirectory(); } }).observe($('#dirList'));
}

// ── directory columns ──────────────────────────────────────────────────────
// The static HTML has one column per region (it works without script), but
// Science has more groups than the other two regions together, so its column
// was three times longer. This puts the groups, in nav order, into columns of
// almost equal height. A column that starts inside a region gets that region
// heading again. The column count is the count that the old auto-fit grid
// gave (280px minimum, 14px gap). Hidden groups (filter) have no height and
// make no heading.
const DIR_MIN = 280, DIR_GAP = 14;
let dirItems = null;
function balanceDirectory() {
  const dir = $('#dirList');
  if (!dirItems) dirItems = $$('.dir-group', dir).map(g => ({ g, region: g.closest('.dir-col').dataset.region, name: $('.dir-region', g.closest('.dir-col')).textContent }));
  const n = Math.max(1, Math.floor((dir.clientWidth + DIR_GAP) / (DIR_MIN + DIR_GAP)));
  const shown = dirItems.filter(it => !it.g.hidden);
  // Height of a region heading, from one that is in the DOM now.
  const probe = $('.dir-region:not([hidden])', dir);
  const hh = (probe ? probe.offsetHeight : 18) + DIR_GAP;
  const h = shown.map(it => it.g.offsetHeight + DIR_GAP);
  // cost(i, j): height of a column that holds shown[i..j).
  const cost = (i, j) => { let t = 0; for (let k = i; k < j; k++) t += h[k] + (k === i || shown[k].region !== shown[k - 1].region ? hh : 0); return t; };
  // Linear partition: split the list into k runs with the smallest tallest
  // run. A big group can leave one run short, so try each count from n down
  // to half of n and keep the most even one (the most columns on a tie).
  const m = shown.length;
  function split(k) {
    const best = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(Infinity));
    const cut = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(0));
    best[0][0] = 0;
    for (let c = 1; c <= k; c++) for (let j = 1; j <= m; j++) for (let i = c - 1; i < j; i++) {
      const v = Math.max(best[c - 1][i], cost(i, j));
      if (v < best[c][j]) { best[c][j] = v; cut[c][j] = i; }
    }
    const r = [];
    for (let c = k, j = m; c > 0; c--) { const i = cut[c][j]; r.unshift([i, j]); j = i; }
    const t = r.map(([i, j]) => cost(i, j));
    return { r, spread: (Math.max(...t) - Math.min(...t)) / Math.max(...t) };
  }
  let runs = [[0, m]], spread = Infinity;
  for (let k = Math.min(n, m); k >= Math.max(2, Math.ceil(n / 2)); k--) {
    const s = split(k);
    if (s.spread < spread - 0.04) { runs = s.r; spread = s.spread; }
  }
  // Build the columns. A hidden group goes after the shown group before it.
  const out = runs.map(() => { const d = document.createElement('div'); d.className = 'dir-col'; return d; });
  let col = 0, prev = null, si = 0;
  const headed = new Set();
  dirItems.forEach(it => {
    if (it.g.hidden) { out[col].append(it.g); return; }
    while (col < runs.length - 1 && si >= runs[col][1]) { col++; prev = null; }
    if (it.region !== prev) {
      const p = document.createElement('p');
      p.className = 'dir-region'; p.textContent = it.name;
      if (headed.has(it.region)) p.classList.add('cont');
      out[col].append(p); prev = it.region; headed.add(it.region);
    }
    out[col].append(it.g); si++;
  });
  dir.style.gridTemplateColumns = `repeat(${out.length}, minmax(0, 1fr))`;
  dir.replaceChildren(...out);
}

// ── video facade ───────────────────────────────────────────────────────────
// The player (#videoFacade) shows a local poster until a click, then a
// YouTube iframe. A channel card (.yt in #ytRail) plays its video in the
// same player: the iframe swaps to that id, the card is marked current,
// and the player scrolls into view. Nothing loads from YouTube before the
// first click.
function initVideo() {
  const b = $('#videoFacade');
  function play(id, title) {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
    f.title = title;
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    b.replaceChildren(f); b.style.cursor = 'default';
    $$('.yt').forEach(c => c.classList.toggle('on', c.dataset.yt === id));
  }
  b.addEventListener('click', () => { if (!$('iframe', b)) play(b.dataset.yt, 'Stella Nova gameplay'); });
  $$('.yt').forEach(c => c.addEventListener('click', () => {
    play(c.dataset.yt, c.dataset.title);
    const r = b.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) b.scrollIntoView({ block: 'center', behavior: RM.matches ? 'auto' : 'smooth' });
  }));
}

// ── bug form ───────────────────────────────────────────────────────────────
// Same endpoint and fields as the old home: formsubmit.co, AJAX mode.
function initBugForm() {
  const form = $('#bugForm'), btn = $('#bugSubmitBtn'), err = $('#bugErr'), ok = $('#bugSuccess');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    if (!String(data.get('summary') || '').trim()) { err.textContent = 'Add a short summary first.'; form.summary.focus(); return; }
    err.textContent = ''; btn.disabled = true; $('b', btn).textContent = 'Transmitting…';
    const sev = data.get('severity') || 'medium';
    data.append('_subject', `[Stella Nova Bug] [${String(sev).toUpperCase()}] ${data.get('summary')}`);
    data.append('_captcha', 'false'); data.append('_template', 'box');
    fetch('https://formsubmit.co/ajax/dave@davesgames.io', { method: 'POST', body: data })
      .then(r => r.json())
      .then(res => { if (res.success) { ok.hidden = false; form.hidden = true; } else throw new Error('fail'); })
      .catch(() => { btn.disabled = false; $('b', btn).textContent = 'Transmit report'; err.textContent = 'Transmission failed. Try again, or report it on the Discord.'; });
  });
}

// ── reveal on scroll ───────────────────────────────────────────────────────
function initReveal() {
  const sel = '.band-head, #featuredRail .card, .inspector, .sector, .game-head, .loop, .sys, .media-head, .media-grid > *, .rev-head, .rev, .dl, .report, .dir-group, .foot > *';
  const els = $$(sel);
  const groups = new Map();
  els.forEach(el => {
    el.classList.add('rv');
    const k = el.parentElement; const n = groups.get(k) || 0; groups.set(k, n + 1);
    if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', Math.min(n, 8));
  });
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
}

// ── portal spotlight ───────────────────────────────────────────────────────
// A soft light follows the pointer across a portal. No 3D tilt: Safari
// clipped the portal image under the old preserve-3d transform.
function initSpot() {
  if (!HOVER.matches || RM.matches) return;
  $$('.portal').forEach(el => el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
  }));
}

// ── commit heatmap ─────────────────────────────────────────────────────────
// One year of daily commit counts to the private game repository, drawn as a
// calendar under the hero social row. commit-data.js holds only a start date
// and one count per day (tools/commit-counts.py writes it), so the page shows
// no hash, message or file. Columns are weeks (Sunday on top). Color is the
// plasma ramp on a log scale, from step 0.18 so the faintest day still clears
// the dark surface. A day with no commits is a faint empty cell. Hover or tap
// shows the date and the count. The grid builds again on resize, and on a
// phone it scrolls sideways inside its card, open at the latest week.
const PLASMA = ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'];
function plasma(t) {
  const x = Math.max(0, Math.min(1, t)) * (PLASMA.length - 1), i = Math.min(PLASMA.length - 2, Math.floor(x)), f = x - i;
  const a = parseInt(PLASMA[i].slice(1), 16), b = parseInt(PLASMA[i + 1].slice(1), 16);
  const ch = s => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function buildCommits() {
  const D = O.COMMITS, box = $('#commits');
  if (!box) return;
  if (!D || !D.days || !D.days.length) { box.hidden = true; return; }
  const days = D.days, n = days.length, cols = Math.ceil(n / 7);
  const t0 = Date.parse(D.start + 'T00:00:00Z');
  const dayAt = i => new Date(t0 + i * 864e5);
  const fmt = (d, o) => d.toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o));
  const max = Math.max(...days), lmax = Math.log1p(max);
  const color = c => c ? plasma(0.18 + 0.82 * Math.log1p(c) / lmax) : null;
  const num = v => v.toLocaleString('en-US');
  // Events on the calendar: an outline around each day of the event, a
  // label over its first week, and the name in the tooltip. Dates are UTC
  // days, both ends included. Steam Next Fest June 2026 ran 15 to 22 June
  // (Steamworks: 10:00 PDT on the 15th to 10:00 PDT on the 22nd).
  const EVENTS = [{ name: 'Steam Next Fest', short: 'Next Fest', from: '2026-06-15', to: '2026-06-22' }];
  const dayIdx = s => Math.round((Date.parse(s + 'T00:00:00Z') - t0) / 864e5);
  const eventAt = i => EVENTS.find(e => i >= dayIdx(e.from) && i <= dayIdx(e.to));

  // Stats: total, active days, peak day, longest streak, busiest month.
  const total = days.reduce((a, b) => a + b, 0), active = days.filter(Boolean).length;
  const peak = days.indexOf(max);
  let streak = 0, run = 0;
  for (const c of days) { run = c ? run + 1 : 0; streak = Math.max(streak, run); }
  const months = new Map();
  days.forEach((c, i) => { const k = dayAt(i).toISOString().slice(0, 7); months.set(k, (months.get(k) || 0) + c); });
  const [bm, bmc] = [...months].reduce((a, b) => b[1] > a[1] ? b : a);
  const monthName = k => fmt(new Date(k + '-01T00:00:00Z'), { month: 'long', year: 'numeric' });
  $('[data-c="total"]', box).textContent = num(total);
  $('[data-c="range"]', box).textContent = `${fmt(dayAt(0), { day: 'numeric', month: 'short', year: 'numeric' })} to ${fmt(dayAt(n - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('[data-c="stats"]', box).innerHTML = [
    ['Active days', `${active} <small>of ${n}</small>`],
    ['Peak day', `${max} <small>${fmt(dayAt(peak), { day: 'numeric', month: 'short' })}</small>`],
    ['Longest streak', `${streak} <small>days</small>`],
    ['Busiest month', `${num(bmc)} <small>${fmt(new Date(bm + '-01T00:00:00Z'), { month: 'short' })}</small>`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('[data-c="lo"]', box).textContent = '1';
  $('[data-c="hi"]', box).textContent = max;
  $('.commits-ramp', box).style.background = `linear-gradient(90deg, ${[0, .25, .5, .75, 1].map(t => plasma(0.18 + 0.82 * t)).join(',')})`;
  // Table view for screen readers: monthly totals.
  $('[data-c="table"]', box).innerHTML = '<caption>Commits per month</caption><tr><th scope="col">Month</th><th scope="col">Commits</th></tr>' +
    [...months].map(([k, c]) => `<tr><th scope="row">${monthName(k)}</th><td>${c}</td></tr>`).join('');

  const scroll = $('.commits-scroll', box), tip = $('.commits-tip', box);
  const LX = 30, TY = 18, GAP = 3;
  let cell = 14, svg = null;
  function draw() {
    const w = scroll.clientWidth;
    cell = Math.max(11, Math.min(20, Math.floor((w - LX) / cols) - GAP));
    const step = cell + GAP, W = LX + cols * step - GAP, H = TY + 7 * step - GAP, EVY = EVENTS.length ? 16 : 0;
    let html = `<svg class="commits-svg" width="${W}" height="${H + EVY}" viewBox="0 0 ${W} ${H + EVY}" role="img" aria-label="${num(total)} commits over ${n} days, ${active} active days, peak ${max} in one day">`;
    // Month labels over the first week that holds the 1st of the month.
    let lastM = -1;
    for (let c = 0; c < cols; c++) {
      const d = dayAt(c * 7 + 6 < n ? c * 7 + 6 : n - 1), m = d.getUTCMonth();
      if (m !== lastM && d.getUTCDate() <= 7) { html += `<text class="cm-m" x="${LX + c * step}" y="11">${fmt(d, { month: 'short' })}</text>`; lastM = m; }
      else if (lastM === -1) lastM = m;
    }
    [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']].forEach(([r, t]) => { html += `<text class="cm-d" x="0" y="${TY + r * step + cell * 0.72}">${t}</text>`; });
    for (let i = 0; i < n; i++) {
      const c = Math.floor(i / 7), r = i % 7, col = color(days[i]);
      html += `<rect x="${LX + c * step}" y="${TY + r * step}" width="${cell}" height="${cell}" rx="${Math.min(4, cell / 4)}"${col ? ` fill="${col}" class="on"` : ' class="off"'} style="--d:${c}"/>`;
    }
    // Event outlines and labels go after the cells, so rect index i stays
    // day i (show() reads svg rects by index). One outline goes around the
    // event days: each cell edge with no event day next to it is drawn. The
    // label goes under the grid, in the extra EVY band, clear of the months.
    EVENTS.forEach(e => {
      const a = Math.max(0, dayIdx(e.from)), b = Math.min(n - 1, dayIdx(e.to));
      if (a > b) return;
      const inEv = i => i >= a && i <= b;
      let d = '';
      for (let i = a; i <= b; i++) {
        const c = Math.floor(i / 7), r = i % 7, x0 = LX + c * step - 1.5, y0 = TY + r * step - 1.5, x1 = x0 + step, y1 = y0 + step;
        if (r === 0 || !inEv(i - 1)) d += `M${x0} ${y0}H${x1}`;
        if (r === 6 || !inEv(i + 1)) d += `M${x0} ${y1}H${x1}`;
        if (!inEv(i - 7)) d += `M${x0} ${y0}V${y1}`;
        if (!inEv(i + 7)) d += `M${x1} ${y0}V${y1}`;
      }
      html += `<path class="cm-ev" d="${d}"/><text class="cm-evl" x="${LX + Math.floor(a / 7) * step - 1.5}" y="${H + EVY - 3}">${esc(e.short)} ${fmt(dayAt(a), { day: 'numeric' })}–${fmt(dayAt(b), { day: 'numeric', month: 'short' })}</text>`;
    });
    scroll.innerHTML = html + '</svg>';
    svg = scroll.firstChild;
    scroll.scrollLeft = scroll.scrollWidth;
  }
  // Hit test by grid position, so the gaps between cells also answer.
  function at(e) {
    const r = svg.getBoundingClientRect(), step = cell + GAP;
    const c = Math.floor((e.clientX - r.left - LX + GAP / 2) / step), rr = Math.floor((e.clientY - r.top - TY + GAP / 2) / step);
    const i = c * 7 + rr;
    return c >= 0 && c < cols && rr >= 0 && rr < 7 && i < n ? i : -1;
  }
  let cur = -1;
  function show(i) {
    if (i === cur) return;
    cur = i;
    $$('rect.hot', svg).forEach(x => x.classList.remove('hot'));
    if (i < 0) { tip.hidden = true; return; }
    const rect = svg.querySelectorAll('rect')[i];
    rect.classList.add('hot');
    const c = days[i];
    const ev = eventAt(i);
    tip.innerHTML = `<b>${c ? num(c) : 'No'} commit${c === 1 ? '' : 's'}</b><span>${fmt(dayAt(i), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>${ev ? `<span class="ev">${esc(ev.name)}</span>` : ''}`;
    tip.hidden = false;
    const br = box.getBoundingClientRect(), rr = rect.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.max(8, Math.min(br.width - tw - 8, rr.left - br.left + rr.width / 2 - tw / 2));
    const y = rr.top - br.top - th - 8;
    tip.style.transform = `translate(${x.toFixed(1)}px, ${(y < 4 ? rr.bottom - br.top + 8 : y).toFixed(1)}px)`;
  }
  scroll.addEventListener('pointermove', e => { if (svg && e.pointerType === 'mouse') show(at(e)); });
  scroll.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') show(-1); });
  scroll.addEventListener('click', e => { if (svg) { const i = at(e); show(i === cur ? -1 : i); } });
  scroll.addEventListener('scroll', () => show(-1), { passive: true });
  draw();
  let rt = 0, lw = scroll.clientWidth;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (scroll.clientWidth !== lw) { lw = scroll.clientWidth; cur = -1; tip.hidden = true; draw(); } }, 150); });
}

// A hidden control: a click on the "davesgames.io / observatory online"
// eyebrow opens the shell screensaver menu (lib/screensaver.js). The home
// page runs in the shell iframe, so it calls the shell through
// window.parent. The eyebrow does not look like a button. Outside the
// shell (file:// or the page alone), the click does nothing.
function initSaverKey() {
  const eb = document.querySelector('.hero .eyebrow') || document.querySelector('.eyebrow');
  if (!eb) return;
  eb.addEventListener('click', () => {
    let ss = null;
    try { ss = (window.parent && window.parent.snScreensaver) || window.snScreensaver; } catch (e) { ss = window.snScreensaver; }
    if (ss && ss.open) ss.open();
  });
}

buildCommits();
buildFeatured();
buildChart();
buildSectors();
initRails();
initDock();
$$('[data-find]').forEach(initFind);
initFindKey();
initDirectory();
balanceDirectory();
initVideo();
initBugForm();
initSaverKey();
initReveal();
initSpot();
startSky();
})(window.Observatory = window.Observatory || {});
