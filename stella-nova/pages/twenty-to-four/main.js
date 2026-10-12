// ============================================================================
//  TWENTY TO FOUR  ·  main.js — the page: state, story column, stage, input
// ----------------------------------------------------------------------------
//  The story column (story.js) drives the stage (scenes.js on render.js).
//  The chapter nearest the top third of the column is active, and its scene
//  is on the stage. Widgets in the chapters set the state S and show live
//  numbers from the stage readouts.
//
//  STATE  S (one object; saver.js changes it too)
//      t, playing, speed, lam      physical time (c = 1), wavelength
//      chapter, scene              the active chapter and its scene
//      probe                       the point of the curl, cube and forms
//      map, arrows, lineGap        the field sheet
//      gauge, gaugeMap, divField   chapter widgets
//      hl                          a Maxwell group the column points at
//      view {yaw,pitch,zoom,held}  the user's change to the scene camera
//      band {t,b} | null           the clear part of the stage (phone sheet,
//                                  saver plate), in CSS px from top and base
//      clock                       wall time, s
//      cycle0                      clock at the start of the loop and cube
//                                  animations (the saver resets it per shot)
//      camTarget, camHalf          saver camera overrides (scenes.js goal)
//      fade                        1 = no fade; the saver dips it at a cut
//
//  GREP MAP
//      grep -n "function buildStory"   chapters into the column
//      grep -n "function widget"       the widgets by name
//      grep -n "function setChapter"   chapter -> scene
//      grep -n "function layout"       stage size, phone sheet, band
//      grep -n "function bindPointer"  orbit, zoom, tap to move the probe
//      grep -n "function frame"        the loop
//      grep -n "window.t24"            the hook object for saver.js
// ============================================================================
import { createRenderer } from './render.js';
import { createStage } from './scenes.js';
import { CHAPTERS } from './story.js';
import { GROUPS, QUANTITIES } from './tex.js';
import { installDefs, eqSVG, has } from './math.js';
import * as F from './field.js';

const $ = id => document.getElementById(id);
const canvas = $('gl'), stageEl = $('stage'), storyEl = $('story'), scrollEl = $('story-scroll');
const PHONE_Q = matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)');

export const S = {
  t: 0, playing: true, speed: 1, lam: 1, lineGap: 0.28,
  chapter: 'twenty', scene: 'fold', probe: [0.55, 0, 0.32],
  map: 'B', arrows: 0, gauge: 0.6, gaugeMap: 'Az', divField: 'E', triple: 1,
  hl: null, view: { yaw: 0, pitch: 0, zoom: 1, held: false }, band: null, clock: 0,
  saver: false, fade: 1,
};

// ── the story column ───────────────────────────────────────────────────────
const inline = html => html.replace(/\{\{(\w+)\}\}/g, (m, k) => has(k) ? `<span class="im">${eqSVG(k)}</span>` : m);
function buildStory() {
  installDefs();
  const frag = document.createDocumentFragment();
  CHAPTERS.forEach((c, i) => {
    const sec = document.createElement('section');
    sec.className = 'ch'; sec.dataset.id = c.id; sec.id = 'ch-' + c.id;
    sec.innerHTML = `<header class="ch-h"><p class="kicker"><span class="no">${i + 1}</span>${c.kicker}</p><h2>${c.title}</h2></header>` + inline(c.html);
    sec.querySelectorAll('[data-eq]').forEach(el => { el.classList.add('eq'); el.innerHTML = eqSVG(el.dataset.eq); });
    sec.querySelectorAll('[data-w]').forEach(el => widget(el.dataset.w, el, c));
    frag.appendChild(sec);
  });
  $('chapters').appendChild(frag);
  document.querySelectorAll('[data-sym]').forEach(el => { el.innerHTML = eqSVG(el.dataset.sym); });
}

// ── widgets ────────────────────────────────────────────────────────────────
const live = [];   // functions run ~8 times a second to refresh numbers
const fmt = v => {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) { const e = Math.floor(Math.log10(a)), m = v / 10 ** e; return `${m.toFixed(2)}×10<sup>${e}</sup>`; }
  return v.toFixed(3);
};
function bars(el, items) {
  const m = Math.max(1e-12, ...items.map(i => Math.abs(i.v)));
  el.innerHTML = items.map(i => {
    const w = Math.abs(i.v) / m * 50, left = i.v < 0 ? 50 - w : 50;
    return `<div class="bar${i.sum ? ' sum' : ''}"><span class="bl">${i.label}</span><span class="bt"><i style="left:${left}%;width:${w}%;--c:${i.c || 'var(--ink)'}"></i><b></b></span><span class="bv">${fmt(i.v / m)}</span></div>`;
  }).join('');
}
function seg(el, opts, cur, on) {
  el.classList.add('seg');
  el.innerHTML = opts.map(([v, h]) => `<button type="button" data-v="${v}"${v === cur ? ' class="on"' : ''}>${h}</button>`).join('');
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    on(b.dataset.v);
  });
}
function slider(label, min, max, step, get, set, show) {
  const row = document.createElement('label');
  row.className = 'sl';
  row.innerHTML = `<span class="sl-l">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${get()}"><span class="sl-v"></span>`;
  const inp = row.querySelector('input'), val = row.querySelector('.sl-v');
  const upd = () => { val.innerHTML = show(+inp.value); };
  inp.addEventListener('input', () => { set(+inp.value); upd(); });
  upd();
  return row;
}

function widget(name, el, ch) {
  el.classList.add('w', 'w-' + name);
  if (name === 'groups') {
    el.innerHTML = GROUPS.map((g, gi) => `<div class="grp" data-g="${gi}" tabindex="0"><span class="gl">${g.g}</span><div class="gb"><span class="gn">${g.name}</span>${g.lines.map(i => `<span class="gm">${eqSVG('m' + String(i + 1).padStart(2, '0'))}</span>`).join('')}</div></div>`).join('');
    let pinned = null;
    const set = gi => { S.hl = gi; el.querySelectorAll('.grp').forEach(r => r.classList.toggle('lit', +r.dataset.g === gi)); };
    el.querySelectorAll('.grp').forEach(r => {
      const gi = +r.dataset.g;
      r.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && pinned == null) set(gi); });
      r.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && pinned == null) set(null); });
      r.addEventListener('click', () => { pinned = pinned === gi ? null : gi; set(pinned); });
      r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); } });
    });
  } else if (name === 'quantities') {
    el.innerHTML = '<div class="qt">' + QUANTITIES.map((q, i) => `<span class="qa">${eqSVG('q' + i + 'a')}</span><span class="qn">${q[1]}</span><span class="qb">${eqSVG('q' + i + 'b')}</span>`).join('') + '</div>';
  } else if (name === 'four') {
    const L = [['I', 'Gauss', 'Electric field lines begin and end on charge.'], ['II', 'No magnetic charge', 'Magnetic field lines never end.'],
      ['III', 'Faraday', 'A changing magnetic field curls the electric field.'], ['IV', 'Ampère and Maxwell', 'Current, and a changing electric field, curl the magnetic field.']];
    el.innerHTML = L.map(([n, t, d]) => `<div class="law"><div class="lh"><span class="ln">${n}</span><span class="lt">${t}</span></div><div class="lm">${eqSVG('law' + n)}</div><p>${d}</p></div>`).join('');
  } else if (name === 'falloff') {
    el.innerHTML = '<canvas class="chart" aria-label="Size of the three parts of the field against kr"></canvas><p class="cap">The size of the field on the equator against <i>kr</i>, on log scales. Dashed: the three parts alone. The marker is the probe distance of the curl chapter.</p>';
    const cv = el.querySelector('canvas');
    const draw = () => drawFalloff(cv);
    new ResizeObserver(draw).observe(cv);
    live.push(() => { if (S.chapter === 'field' && cv.dataset.key !== chartKey()) draw(); });
  } else if (name === 'maps') {
    const M = [['B', 'sb', 'sBy'], ['Ex', 'sP', 'sEx'], ['Ez', 'sR', 'sEz'], ['Jx', 'sp1', 'sJx'], ['Jz', 'sr1', 'sJz'], ['Az', 'sH', 'sAz'], ['phi', 'sPsi', 'sphi'], ['none', '', '']];
    const box = document.createElement('div');
    seg(box, M.map(([v, a, b]) => [v, v === 'none' ? 'Lines only' : `<span class="mx">${eqSVG(a)}</span><span class="md">${eqSVG(b)}</span>`]), S.map, v => { S.map = v; });
    box.classList.add('maps');
    el.appendChild(box);
    const cap = document.createElement('p'); cap.className = 'cap';
    cap.textContent = 'Top: Maxwell’s symbol. Below: today’s name. In this plane the y parts of E and A are zero, so they have no button.';
    el.appendChild(cap);
  } else if (name === 'fieldctl') {
    el.appendChild(slider('Wavelength', 0.6, 1.6, 0.05, () => S.lam, v => { S.lam = v; }, v => `${v.toFixed(2)}`));
    el.appendChild(slider('Speed', 0, 2, 0.05, () => S.speed, v => { S.speed = v; }, v => `${v.toFixed(2)}×`));
    el.appendChild(slider('Line spacing', 0.12, 0.5, 0.01, () => S.lineGap, v => { S.lineGap = v; }, v => v.toFixed(2)));
    const a = document.createElement('div');
    seg(a, [['0', 'No arrows'], ['1', 'Arrows of E']], String(S.arrows), v => { S.arrows = +v; });
    el.appendChild(a);
  } else if (name === 'curl') {
    const which = ch.id === 'curlB' ? 'B' : 'E';
    el.innerHTML = `<table class="ct"><thead><tr><th>loop</th><th>circulation ÷ area</th><th>partials</th><th>${which === 'B' ? eqSVG('ldispB') : eqSVG('lmdBdt')}</th></tr></thead><tbody></tbody></table><p class="cap">Scaled by the largest size of the curl at the probe. The loop column integrates round a square of side 10<sup>−3</sup>; the partials column takes the derivatives of Maxwell’s lines; the last column is the other side of the law.</p>`;
    const tb = el.querySelector('tbody');
    live.push(() => {
      const r = stage.readouts.curl;
      if (!r || r.which !== which || S.chapter !== ch.id) return;
      const m = Math.max(1e-12, ...r.lines.map(Math.abs), ...r.cmp.map(Math.abs));
      tb.innerHTML = ['yz', 'zx', 'xy'].map((p, i) => `<tr><td><i>${p}</i> → <i>${'xyz'[i]}</i></td><td>${fmt(r.loops[i] / m)}</td><td>${fmt(r.lines[i] / m)}</td><td>${fmt(r.cmp[i] / m)}</td></tr>`).join('');
    });
  } else if (name === 'div') {
    const top = document.createElement('div');
    seg(top, [['E', `Field ${eqSVG('iE')}`], ['B', `Field ${eqSVG('iB')}`]], S.divField, v => { S.divField = v; });
    el.appendChild(top);
    const b = document.createElement('div'); b.className = 'bars'; el.appendChild(b);
    const cap = document.createElement('p'); cap.className = 'cap'; cap.innerHTML = 'Each bar is one pair of faces: the flux out minus the flux in, divided by the volume. Scaled by the largest bar.'; el.appendChild(cap);
    live.push(() => {
      const r = stage.readouts.div;
      if (!r || S.chapter !== 'div') return;
      const c = r.which === 'B' ? 'var(--m1)' : 'var(--m2)';
      bars(b, [0, 1, 2].map(i => ({ label: `∂<sub>${'xyz'[i]}</sub>${r.which}<sub>${'xyz'[i]}</sub>`, v: r.pairs[i], c }))
        .concat([{ label: 'sum', v: r.pairs[0] + r.pairs[1] + r.pairs[2], c: 'var(--ink)', sum: true }]));
    });
  } else if (name === 'gauge') {
    el.appendChild(slider(`Gauge ${eqSVG('ichi')}`, 0, 1, 0.01, () => S.gauge, v => { S.gauge = v; }, v => `g = ${v.toFixed(2)}`));
    const m = document.createElement('div');
    seg(m, [['Az', `Map ${eqSVG('sAz')}`], ['phi', `Map ${eqSVG('sphi')}`]], S.gaugeMap, v => { S.gaugeMap = v; });
    el.appendChild(m);
    const out = document.createElement('div'); out.className = 'readout'; el.appendChild(out);
    live.push(() => {
      const r = stage.readouts.gauge;
      if (!r || S.chapter !== 'gauge') return;
      out.innerHTML = `<div><span>Change in ${eqSVG('iA')}</span><b>${fmt(r.dA)}</b></div><div><span>Change in ${eqSVG('iE')}</span><b>${fmt(r.dE)}</b></div><div><span>Change in ${eqSVG('iB')}</span><b>${fmt(r.dB)}</b></div>`;
    });
    const cap = document.createElement('p'); cap.className = 'cap';
    cap.textContent = 'Measured near the blob: the largest change of each field, against the size of E there. A changes by order one; E and B change by rounding error of the finite differences.';
    el.appendChild(cap);
  } else if (name === 'forms') {
    const AX = ['t', 'x', 'y', 'z'];
    let grid = '<div class="fm"><span></span>' + AX.map(a => `<span class="fh">${eqSVG('ix' + a)}</span>`).join('');
    for (let r = 0; r < 4; r++) grid += `<span class="fh">${eqSVG('ix' + AX[r])}</span>` + [0, 1, 2, 3].map(c => `<span class="fc" data-rc="${r}${c}">${eqSVG('Fc' + (r * 4 + c))}</span>`).join('');
    grid += '</div>';
    el.innerHTML = grid + '<div class="tri"></div><div class="tri-eq eq"></div><div class="bars"></div><p class="cap">The three terms of the chosen component at the probe, scaled by the largest. They cancel.</p>';
    const T = [['xyz', 'tXYZ', 'II'], ['tyz', 'tTYZ', 'III, x'], ['tzx', 'tTZX', 'III, y'], ['txy', 'tTXY', 'III, z']];
    const tri = el.querySelector('.tri'), teq = el.querySelector('.tri-eq'), bb = el.querySelector('.bars');
    const show = i => {
      S.triple = i;
      teq.innerHTML = eqSVG(T[i][1]);
      const [l, m, n] = F.TRIPLES[i];
      const cells = new Set([`${m}${n}`, `${n}${m}`, `${n}${l}`, `${l}${n}`, `${l}${m}`, `${m}${l}`]);
      el.querySelectorAll('.fc').forEach(c => c.classList.toggle('lit', cells.has(c.dataset.rc)));
    };
    seg(tri, T.map(([a, , law], i) => [String(i), `(${a.split('').join(' ')}) <small>law ${law}</small>`]), String(S.triple), v => show(+v));
    show(S.triple);
    live.push(() => {
      if (S.chapter !== 'forms') return;
      const k = F.kOf(S.lam), P = S.probe, h = 1e-5, [l, m, n] = F.TRIPLES[S.triple];
      const at = X => { const E = [0, 0, 0], B = [0, 0, 0]; F.EB(X[1], X[2], X[3], X[0], k, E, B); return F.tensorF(E, B); };
      const X = [S.t, ...P];
      const d = (mu, a, b) => { const p = X.slice(), q = X.slice(); p[mu] += h; q[mu] -= h; return (at(p)[a][b] - at(q)[a][b]) / (2 * h); };
      const A = 'txyz';
      const terms = [[l, m, n], [m, n, l], [n, l, m]].map(([a, b, c]) => ({ label: `∂<sub>${A[a]}</sub>F<sub>${A[b]}${A[c]}</sub>`, v: d(a, b, c), c: 'var(--ink)' }));
      bars(bb, terms.concat([{ label: 'sum', v: terms.reduce((s, x) => s + x.v, 0), sum: true }]));
    });
  }
}

// The falloff chart: |E| on the equator against kr, log-log.
const chartKey = () => S.lam + ',' + S.probe.map(v => v.toFixed(3)).join(',');
function drawFalloff(cv) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.dataset.key = chartKey();
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = 34, Rr = 10, T = 10, B = 26, x0 = -1.3, x1 = 1.6, y0 = -2, y1 = 3.6;
  const X = lx => L + (lx - x0) / (x1 - x0) * (w - L - Rr), Y = ly => T + (1 - (ly - y0) / (y1 - y0)) * (h - T - B);
  g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = '#7f8b96'; g.strokeStyle = 'rgba(160,175,190,0.14)'; g.lineWidth = 1;
  for (let e = -1; e <= 1; e++) { g.beginPath(); g.moveTo(X(e), T); g.lineTo(X(e), h - B); g.stroke(); g.fillText(e === 0 ? '1' : `10${e < 0 ? '⁻¹' : ''}`, X(e) - 6, h - 8); }
  for (let e = -2; e <= 3; e++) { g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(w - Rr, Y(e)); g.stroke(); }
  g.fillText('kr', w - Rr - 14, h - 8);
  const curve = (f, col, dash, lw) => {
    g.beginPath(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = lw;
    for (let i = 0; i <= 120; i++) { const lx = x0 + (x1 - x0) * i / 120, v = Math.log10(f(10 ** lx)); const yy = Y(Math.max(y0 - 1, Math.min(y1 + 1, v))); i ? g.lineTo(X(lx), yy) : g.moveTo(X(lx), yy); }
    g.stroke(); g.setLineDash([]);
  };
  g.save(); g.beginPath(); g.rect(L, T, w - L - Rr, h - T - B); g.clip();
  curve(x => 1 / x ** 3, 'rgba(232,137,220,0.75)', [4, 4], 1.2);
  curve(x => 1 / x ** 2, 'rgba(168,164,255,0.75)', [4, 4], 1.2);
  curve(x => 1 / x, 'rgba(98,196,255,0.8)', [4, 4], 1.2);
  curve(F.ampEquator, '#ff9a62', [], 2);
  g.strokeStyle = 'rgba(230,235,240,0.5)'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(0), T); g.lineTo(X(0), h - B); g.stroke(); g.setLineDash([]);
  const kr = F.kOf(S.lam) * Math.hypot(S.probe[0], S.probe[2]), lx = Math.log10(kr);
  g.fillStyle = '#ff9a62'; g.beginPath(); g.arc(X(lx), Y(Math.log10(F.ampEquator(kr))), 3.5, 0, 7); g.fill();
  g.restore();
  g.fillStyle = '#e889dc'; g.fillText('1/(kr)³', X(-1.2), Y(3.2));
  g.fillStyle = '#a8a4ff'; g.fillText('1/(kr)²', X(-0.55), Y(1.6) - 4);
  g.fillStyle = '#62c4ff'; g.fillText('1/kr', X(1.05), Y(-1.05) - 6);
  g.fillStyle = '#c9d2dc'; g.fillText('kr = 1', X(0) + 4, T + 10);
}

// ── chapters ───────────────────────────────────────────────────────────────
const chapterIx = id => CHAPTERS.findIndex(c => c.id === id);
function setChapter(id, opts = {}) {
  const c = CHAPTERS[chapterIx(id)];
  if (!c || (S.chapter === id && !opts.force)) return;
  S.chapter = id; S.scene = c.scene;
  S.view = { yaw: 0, pitch: 0, zoom: 1, held: false };
  if (id !== 'twenty') S.hl = null;
  document.querySelectorAll('.ch').forEach(s => s.classList.toggle('active', s.dataset.id === id));
  const i = chapterIx(id);
  $('dkTitle').textContent = c.title; $('dkNo').textContent = `${i + 1}/${CHAPTERS.length}`;
  $('dkPrev').disabled = i === 0; $('dkNext').disabled = i === CHAPTERS.length - 1;
  legend();
}
function goChapter(i) {
  const c = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, i))];
  const el = $('ch-' + c.id);
  scrollEl.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  setChapter(c.id);
}
function activeFromScroll() {
  const lim = scrollEl.scrollTop + scrollEl.clientHeight * 0.34;
  let id = CHAPTERS[0].id;
  for (const c of CHAPTERS) { const el = $('ch-' + c.id); if (el.offsetTop <= lim) id = c.id; }
  if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4) id = CHAPTERS[CHAPTERS.length - 1].id;
  setChapter(id);
}

// The stage legend: what the colours mean in this scene.
function legend() {
  const sw = (cls, txt) => `<div class="lg"><i class="${cls}"></i><span>${txt}</span></div>`;
  const E = sw('sw-e', `Lines of ${eqSVG('iE')}`), Bt = sw('sw-bt', `${eqSVG('iB')} toward you`), Ba = sw('sw-ba', `${eqSVG('iB')} away`);
  const L = {
    fold: '',
    field: E + Bt + Ba + sw('sw-k', 'The ring kr = 1'),
    curlB: sw('sw-bt', `Loops of ${eqSVG('iB')} and their curl`) + sw('sw-e', eqSVG('ldispB')) + '<p>Drag to turn. Tap the sheet to move the probe.</p>',
    curlE: sw('sw-e', `Loops of ${eqSVG('iE')} and their curl`) + sw('sw-bt', eqSVG('lmdBdt')) + '<p>Drag to turn. Tap the sheet to move the probe.</p>',
    div: sw('sw-e', 'Flux out of each face') + sw('sw-dim', 'Flux in') + '<p>Drag to turn. Tap the sheet to move the cube.</p>',
    four: E + sw('sw-bt', `${eqSVG('iB')} clockwise, seen from above`) + sw('sw-ba', `${eqSVG('iB')} counterclockwise`) + sw('sw-lobe', 'Radiated power') + '<p>Drag to turn.</p>',
    gauge: sw('sw-a', `Arrows of ${eqSVG('iA')}`) + E + '<p>The dashed circle is the blob of χ.</p>',
    forms: sw('sw-ink', 'Loops on the six faces') + '<p>Each edge cancels. Drag to turn.</p>',
  };
  $('legend').innerHTML = L[S.scene] || '';
}

// ── layout ─────────────────────────────────────────────────────────────────
let R = null, stage = null;
let sheetState = 'half';   // phone: 'closed' | 'half' | 'full'
function layout() {
  const phone = PHONE_Q.matches;
  document.body.classList.toggle('phone', phone);
  document.body.dataset.sheet = sheetState;
  const r = stageEl.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (R) R.resize(r.width, r.height, dpr);
  if (S.saver) return;
  if (phone) {
    const top = document.querySelector('.topbar');
    const tb = top && getComputedStyle(top).display !== 'none' ? top.getBoundingClientRect().bottom - r.top : 0;
    const sh = storyEl.getBoundingClientRect(), dock = $('dock').getBoundingClientRect();
    const coverTop = sheetState === 'closed' ? dock.top : Math.min(sh.top, dock.top);
    let b = Math.max(0, r.bottom - coverTop) + 6, t = Math.max(0, tb) + 6;
    const minH = r.height * 0.34;
    if (r.height - t - b < minH) b = Math.max(0, r.height - t - minH);
    S.band = { t, b };
  } else S.band = null;
}
function setSheet(s) {
  sheetState = s;
  document.body.dataset.sheet = s;
  $('dkStory').setAttribute('aria-expanded', String(s !== 'closed'));
  setTimeout(layout, 320);
  layout();
}

// ── pointer: orbit, zoom, tap ──────────────────────────────────────────────
function bindPointer() {
  const pts = new Map();
  let down = null, pinch0 = 0, zoom0 = 1, heldTimer = 0;
  const flat = () => ['fold', 'field', 'gauge'].includes(S.scene);
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) down = { x: e.clientX, y: e.clientY, yaw: S.view.yaw, pitch: S.view.pitch, moved: false };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = S.view.zoom; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) S.view.zoom = Math.max(0.35, Math.min(3, zoom0 * pinch0 / d));
      if (down) down.moved = true;
      return;
    }
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 6) down.moved = true;
    if (down.moved && !flat()) {
      S.view.yaw = down.yaw - dx * 0.006; S.view.pitch = Math.max(-1.2, Math.min(1.2, down.pitch + dy * 0.005));
      S.view.held = true; clearTimeout(heldTimer);
    }
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (pts.size === 0 && down) {
      if (!down.moved) tap(e.clientX, e.clientY);
      down = null;
      heldTimer = setTimeout(() => { S.view.held = false; }, 6000);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.view.zoom = Math.max(0.35, Math.min(3, S.view.zoom * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  canvas.addEventListener('dblclick', () => { S.view = { yaw: 0, pitch: 0, zoom: 1, held: false }; });
  function tap(cx, cy) {
    if (PHONE_Q.matches && sheetState === 'full') { setSheet('half'); return; }
    if (!['curlB', 'curlE', 'div', 'forms', 'field'].includes(S.scene)) return;
    const r = canvas.getBoundingClientRect(), p = stage.pick(S, cx - r.left, cy - r.top);
    if (!p) return;
    const rho = Math.abs(p[0]);
    if (rho < 0.12 || rho > 2 || Math.abs(p[2]) > 1.6) return;
    S.probe = [p[0], 0, p[2]];
  }
}

// ── dock and keys ──────────────────────────────────────────────────────────
function bindDock() {
  $('dkPlay').addEventListener('click', () => { S.playing = !S.playing; syncPlay(); });
  $('dkPrev').addEventListener('click', () => goChapter(chapterIx(S.chapter) - 1));
  $('dkNext').addEventListener('click', () => goChapter(chapterIx(S.chapter) + 1));
  $('dkChapter').addEventListener('click', () => { if (PHONE_Q.matches) setSheet(sheetState === 'closed' ? 'half' : sheetState === 'half' ? 'full' : 'closed'); else goChapter(chapterIx(S.chapter)); });
  $('dkStory').addEventListener('click', () => setSheet(sheetState === 'closed' ? 'half' : 'closed'));
  // The sheet grip: tap to toggle half and full, drag down to close.
  const grip = $('sheetGrip');
  let y0 = null;
  grip.addEventListener('pointerdown', e => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (dy > 40) setSheet(sheetState === 'full' ? 'half' : 'closed');
    else if (dy < -40) setSheet('full');
    else setSheet(sheetState === 'full' ? 'half' : 'full');
  });
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); S.playing = !S.playing; syncPlay(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goChapter(chapterIx(S.chapter) + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goChapter(chapterIx(S.chapter) - 1); }
  });
}
function syncPlay() {
  const b = $('dkPlay');
  b.classList.toggle('paused', !S.playing);
  b.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  b.title = S.playing ? 'Pause (space)' : 'Play (space)';
}

// ── the loop ───────────────────────────────────────────────────────────────
let last = 0, liveAt = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  const now = ms / 1000, dt = Math.min(0.1, last ? now - last : 0);
  last = now;
  S.clock += dt;
  if (S.saverTick) S.saverTick(dt);
  // One period every 4 s at speed 1 (c = 1, so the period is λ).
  if (S.playing) S.t += dt * S.speed * S.lam / 4;
  stage.draw(S, S.clock);
  if (now - liveAt > 0.12) { liveAt = now; for (const f of live) f(); }
}

function boot() {
  buildStory();
  bindDock();
  syncPlay();
  let ok = true;
  try { R = createRenderer(canvas); } catch (e) { R = null; console.error(e); }
  if (!R) { ok = false; $('nogl').hidden = false; }
  if (ok) { try { stage = createStage(R); } catch (e) { ok = false; console.error(e); $('nogl').hidden = false; } }
  setChapter(CHAPTERS[0].id, { force: true });
  scrollEl.addEventListener('scroll', () => requestAnimationFrame(activeFromScroll), { passive: true });
  new ResizeObserver(layout).observe(stageEl);
  addEventListener('resize', layout);
  PHONE_Q.addEventListener?.('change', layout);
  layout();
  if (!ok) return;
  bindPointer();
  const fonts = ["italic 400 16px 'STIX Two Text'", "500 16px 'STIX Two Text'", '500 16px Inter'];
  Promise.all(fonts.map(f => document.fonts.load(f).catch(() => null))).then(() => stage.fontsReady());
  // The screensaver hook loads on its own, so a fault there cannot stop
  // the page.
  import('./saver.js').then(m => m.installSaver({ S, stage, layout, setChapter, CHAPTERS, canvas, R })).catch(e => console.warn('saver', e));
  window.t24 = { S, stage, setChapter, goChapter };
  requestAnimationFrame(frame);
}
boot();
