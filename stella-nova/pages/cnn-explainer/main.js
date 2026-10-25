// ============================================================================
//  CNN EXPLAINER  ·  main.js  boot, state and the network overview
// ----------------------------------------------------------------------------
//  Boot: load model/weights.bin and examples/examples.bin, run the first
//  example (an espresso, as in the original tool) through net.js, paint
//  every map (maps.js) and start the guided run (tour.js) on the overview
//  (draw.js, #netCv). Then the explainer column (explain.js), the zoom
//  panel (detail.js), the photo strip, the upload and camera, the colours
//  pop-up and the credits.
//
//  THE RUN. A new picture starts the run at 0 and plays it. One frame
//  loop (advance) moves the run clock, opens and closes the zoom of the
//  run, moves the zoom that the reader opened, lays out the overview with
//  the open column, puts the zoom panel in place, and draws. The step of
//  the run lights its explainer section, writes its caption in #tCap and,
//  on a phone, scrolls the diagram to its block. The top line names the
//  answer only when the run gets to the end.
//
//  A ZOOM THE READER OPENS (openZoom): a click on a map or a bar, Enter on
//  the overview. The run waits; the column opens from the map; the scan
//  plays. If the run was playing and the reader does not touch the panel,
//  the zoom closes after 8 s and the run goes on. Close (the cross, Esc or
//  a click on the overview) closes it and the run goes on.
//
//  window.cnnPage is the page API: the zoom panel, the explainer and
//  saver.js call it, and the node tests read it. page.advance(dt) is one
//  frame; the tests call it to play the run fast.
//
//  Tests: window.__cnnLoadBytes(url) replaces fetch (jsdom has no file
//  fetch), and window.__cnnNoAutoBoot stops the boot at import.
//
//  grep -n 'export async function boot'   the boot order
//  grep -n 'function run'                 one picture through the network
//  grep -n 'function advance'             one frame: run, zoom, layout, draw
//  grep -n 'function onSegment'           a new step of the run
//  grep -n 'function applyRunZoom'        the zoom of the run
//  grep -n 'function openZoom'            a zoom the reader opens
//  grep -n 'function placeZoom'           the zoom panel geometry
//  grep -n 'function buildTourBar'        play, step, speed, scrubber
//  grep -n 'function drawNet'             the overview frame
//  grep -n 'function relayout'            canvas size and the layout
//  grep -n 'function onPointer'           hover, tip and click
//  grep -n 'function onKey'               keyboard on the overview
//  grep -n 'function buildStrip'          example photos, upload, camera
//  grep -n 'function buildCredits'        the credits drawer
//  grep -n 'SAVER SEAM'                   saver.js
// ============================================================================
import { parseWeights, forward, CLASSES, ARCH } from './net.js';
import { EXAMPLES, SOURCE, exampleRGB } from './data.js';
import { coverResample, rgbToRGBA } from './image.js';
import { layoutNet, hitTest, GRID, zoomFrom, lerpRect } from './layout.js';
import { drawNetwork } from './draw.js';
import { createMaps } from './maps.js';
import { SCALES } from './colour.js';
import { createDetail } from './detail.js';
import { createExplain } from './explain.js';
import { mountGradientPicker } from '../../lib/growth-gradients.js';
import { mountSheet } from '../../lib/sn-panel.js';
import { installSaver } from './saver.js';
import { tourPlan, createClock, flowState, zoomF, scanAt, busyMap, zoomStart, captionOf, answerText, EXPAND_SEC } from './tour.js';

export const PHONE_QUERY = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
const DEFAULT_EXAMPLE = 12;   // espresso
const STORE = 'sn-cnn-explainer';
const ZOOM_ANIM = 0.55;       // s: a zoom the reader opens grows (and shrinks) in this time
const AUTO_HOLD = 8;
const SHORT = ['In', 'C 1·1', 'R 1·1', 'C 1·2', 'R 1·2', 'Pool 1', 'C 2·1', 'R 2·1', 'C 2·2', 'R 2·2', 'Pool 2', 'Out'];          // s: it closes by itself after this, if the run was playing

function store(get, val) {
  try {
    if (get) return JSON.parse(localStorage.getItem(STORE) || '{}');
    localStorage.setItem(STORE, JSON.stringify(val));
  } catch (e) { /* no storage: defaults */ }
  return {};
}

export async function boot() {
  const doc = document, win = window, $ = id => doc.getElementById(id);
  const mq = win.matchMedia ? win.matchMedia(PHONE_QUERY) : { matches: false, addEventListener() {} };
  const rm = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const saved = store(true);
  const S = {
    W: null, bin: null, result: null, rgb: null, pick: DEFAULT_EXAMPLE, own: null,
    grad: saved.grad || 'magma', rev: !!saved.rev, scale: saved.scale || 'layer',
    L: null, hover: null, focus: { li: 1, c: 0 }, raf: 0, last: 0, booted: false, failed: null,
    time: 0, segI: -1, visits: [], zoom: null, answer: null, follow: null, bars: null, zoomScroll: null,
  };
  const plan = tourPlan();
  const tour = createClock(plan);
  const loadBytes = win.__cnnLoadBytes || (async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); });
  const maps = createMaps(doc);
  const cv = $('netCv'), g = cv.getContext('2d'), wrap = $('netWrap'), tip = $('netTip'), live = $('netLive');

  // ── page API ─────────────────────────────────────────────────────────────
  const page = {
    get state() { return S; },
    result: () => S.result,
    maps: () => maps,
    reducedMotion: () => !!rm.matches,
    sceneContext(spec) {
      if (!S.result) return null;
      const li = Math.max(0, Math.min(11, spec.li | 0));
      const c = li === 11 ? (spec.c == null ? S.result.top : spec.c) : li === 0 ? (spec.c == null ? -1 : spec.c) : Math.max(0, Math.min(9, spec.c | 0));
      return { result: S.result, W: S.W, maps, li, c, ci: spec.ci };
    },
    // the reader opens a map (a click, Enter, the tests)
    openDetail(spec) { openZoom(spec); },
    closeZoom, jumpTo, detailTouched,
    openCredits,
    focusOverview() { cv.focus && cv.focus(); },
    onDetail() { requestDraw(); },
    run, runExample, relayout, requestDraw, advance,
    tour, plan,
    get detail() { return detail; },
    get explain() { return explain; },
    // saver.js: the page run waits while the saver plays
    saverPause(on) { if (on) { S.saverWas = tour.playing; tour.pause(); } else { if (S.saverWas && !tour.ended) tour.playing = true; requestDraw(); } },
    examples: EXAMPLES,
  };
  win.cnnPage = page;

  // ── load ─────────────────────────────────────────────────────────────────
  try {
    const [wb, eb] = await Promise.all([
      loadBytes(new URL('model/weights.bin', import.meta.url).href),
      loadBytes(new URL('examples/examples.bin', import.meta.url).href),
    ]);
    S.W = parseWeights(wb); S.bin = eb;
  } catch (e) {
    S.failed = e;
    $('pred').innerHTML = '<span class="pred-word">The network did not load. Reload the page to try again.</span>';
    console.warn('cnn-explainer: load', e);
    return page;
  }

  // ── panels ──────────────────────────────────────────────────────────────
  const learnEl = $('learn');
  let sheet = null;
  const detail = createDetail({ doc, win, page });
  const explain = createExplain({ doc, win, host: $('learnBody'), page });
  sheet = mountSheet({ panel: learnEl, grip: $('sheetGrip'), menu: $('dockLearn'), close: $('learnClose'), phoneQ: mq, doc,
    onOpen: () => win.setTimeout(relayout, 340) });
  buildStrip();
  buildView();
  buildCredits();
  buildTourBar();

  // ── one picture ──────────────────────────────────────────────────────────
  function run(rgb, meta = {}) {
    S.rgb = rgb;
    S.result = forward(S.W, rgb);
    maps.set(S.result, { grad: S.grad, rev: S.rev, scale: S.scale });
    S.answer = answerText(S.result);
    // a new picture: the run starts again at the input
    if (S.zoom) { S.zoom = null; detail.close(); }
    S.visits = []; S.segI = -1; S.follow = null;
    tour.seek(0);
    if (!meta.paused) tour.play();
    setPred(false);
    explain.refresh();
    requestDraw();
    return S.result;
  }
  function runExample(i) {
    S.pick = i; S.own = null;
    markStrip();
    return run(exampleRGB(S.bin, i), { label: EXAMPLES[i].cls });
  }
  function performanceNow() { return win.performance ? win.performance.now() : Date.now(); }
  // the top line: "Looking ..." while the run plays, the answer at the end
  function setPred(on) {
    const el = $('pred');
    if (S.predOn === on && el.firstChild) return;
    S.predOn = on;
    if (!on) {
      el.classList.remove('in');
      el.innerHTML = '<span class="pred-word">Looking at the picture…</span>';
      return;
    }
    const a = S.answer;
    el.innerHTML = `<span class="pred-word">It sees</span><span class="pred-cls"></span><span class="pred-p"></span><span class="pred-2"></span>`;
    el.querySelector('.pred-cls').textContent = a.cls;
    el.querySelector('.pred-p').textContent = a.p;
    el.querySelector('.pred-2').textContent = a.second;
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  }

  // ── the run and the zoom: one frame ─────────────────────────────────────
  // dt in s. The clock moves (unless a zoom of the reader holds it), then
  // the state of the overview and the zoom follow from the time.
  function advance(dt) {
    if (!S.result || !S.L) return;
    const reduced = !!rm.matches;
    S.time += dt;
    const z = S.zoom;
    if (z && z.mode === 'user') {
      if (reduced) z.f = z.target;
      else if (z.target > z.f) z.f = Math.min(1, z.f + dt / ZOOM_ANIM);
      else if (z.target < z.f) z.f = Math.max(0, z.f - dt / ZOOM_ANIM);
      if (z.target === 1 && z.f >= 1 && z.autoHold != null && !z.touched) { z.held += dt; if (z.held >= z.autoHold) z.target = 0; }
      if (z.target === 0 && z.f <= 0) endUserZoom();
      else detail.tick(dt);
    } else tour.tick(dt);
    const at = tour.at();
    if (at.i !== S.segI) { S.segI = at.i; onSegment(at.seg); }
    if (tour.ended && !S.predOn) setPred(true);
    if (!tour.ended && at.seg.kind !== 'answer' && S.predOn) setPred(false);
    if (!S.zoom || S.zoom.mode === 'tour') applyRunZoom(at, reduced);
    layoutNow();
    placeZoom(reduced);
    drawNet();
    if (S.zoom && detail.isOpen) detail.draw();
    updateTourBar();
  }

  // a new step of the run
  function onSegment(seg) {
    if (S.visits[S.visits.length - 1] !== seg.li) S.visits.push(seg.li);
    const reduced = !!rm.matches;
    // (the first step at the start leaves the column at the top: the intro)
    explain.mark(seg.section, { smooth: !reduced, scroll: (!mq.matches || (sheet && sheet.open)) && !(seg.i === 0 && !S.booted) });
    const cap = captionOf(seg, S.result);
    $('tCap').textContent = cap;
    if (seg.kind === 'answer') setPred(true);
    // phone: the diagram scrolls to the block of the step (not while the
    // reader scrolls it)
    if (S.L && S.L.orient === 'v' && seg.kind === 'flow') {
      const col = S.Lbase.cols.find(c => c.li === seg.li);
      if (col) followTo(col.y - 6, reduced);
    }
  }
  function followTo(y, reduced) {
    const stage = $('stage'), head = $('stageHead');
    if (performanceNow() - (S.userScrollAt || -1e9) < 4000) return;
    const top = Math.max(0, (wrap.offsetTop || 0) + y - (head ? head.offsetHeight || 0 : 0) - 4);
    S.follow = { y, top, behavior: reduced ? 'auto' : 'smooth' };
    if (stage.scrollTo) { try { stage.scrollTo({ top, behavior: S.follow.behavior }); } catch (e) { stage.scrollTop = top; } }
  }

  // the zoom of the run: open in a zoom segment, closed in the others
  function applyRunZoom(at, reduced) {
    const seg = at.seg;
    if (seg.kind !== 'zoom') {
      if (S.zoom && S.zoom.mode === 'tour') { S.zoom = null; detail.close(); }
      return;
    }
    if (!S.zoom || S.zoom.seg !== seg) {
      const li = seg.li, c = li === 11 ? S.result.top : busyMap(S.result, li, 0);
      const spec = { li, c };
      const start = zoomStart(S.result, li, c);
      detail.open(spec, { mode: 'tour', start });
      S.zoom = { mode: 'tour', seg, spec, f: 0, start, scrolled: false };
    }
    S.zoom.f = zoomF(seg, at.local, reduced);
    const sc = detail.scene;
    detail.t = scanAt(seg, at.local, S.zoom.start, sc ? sc.count : 0, reduced);
  }

  // ── a zoom the reader opens ─────────────────────────────────────────────
  function openZoom(spec, { auto = true } = {}) {
    if (!S.result) return;
    if (mq.matches && sheet && sheet.open) sheet.setOpen(false);
    const li = Math.max(0, Math.min(11, spec.li | 0));
    const prev = S.zoom;
    const wasPlaying = prev && prev.mode === 'user' ? prev.wasPlaying : tour.playing;
    let resumeAt = prev && prev.mode === 'user' ? prev.resumeAt : null;
    if (prev && prev.mode === 'tour') resumeAt = prev.seg.t1;
    // a layer the run has not shown yet: the run moves on to it
    const fs = flowState(plan, tour.t);
    if (!tour.ended && li > fs.li) {
      const stop = tour.stopOf(li);
      const flowSeg = plan.segs.find(q => q.kind === 'flow' && q.li === li);
      if (flowSeg) tour.seek(flowSeg.t1 - 1e-6);
      if (stop) resumeAt = stop.t1;
    }
    tour.pause();
    const same = prev && prev.spec && prev.spec.li === li;
    S.zoom = { mode: 'user', spec: { ...spec, li }, f: same ? prev.f : 0, target: 1, wasPlaying, resumeAt,
      autoHold: wasPlaying && auto ? AUTO_HOLD : null, held: 0, touched: false, scrolled: false };
    detail.open({ ...spec, li }, { mode: 'user' });
    S.focus = li === 11 ? { bar: spec.c == null ? S.result.top : spec.c } : { li, c: li === 0 ? (spec.c == null ? -1 : spec.c) : spec.c };
    requestDraw();
  }
  // close the zoom: the reader's zoom shrinks back; the run's zoom jumps to
  // its closing part
  function closeZoom() {
    const z = S.zoom;
    if (!z) return;
    if (z.mode === 'user') z.target = 0;
    else { tour.seek(Math.max(tour.t, z.seg.t1 - EXPAND_SEC * Math.max(0.05, z.f))); }
    requestDraw();
  }
  function endUserZoom() {
    const z = S.zoom;
    S.zoom = null; detail.close();
    if (z.resumeAt != null) tour.seek(z.resumeAt);
    if (z.wasPlaying && !tour.ended) tour.playing = true;
    S.segI = -1;
    requestDraw();
  }
  // the reader touched the panel: it stays open; a zoom of the run becomes
  // the reader's zoom and the run waits for it
  function detailTouched() {
    const z = S.zoom;
    if (!z) return;
    if (z.mode === 'user') { z.touched = true; return; }
    const wasPlaying = tour.playing;
    tour.pause();
    S.zoom = { mode: 'user', spec: z.spec, f: z.f, target: 1, wasPlaying, resumeAt: z.seg.t1, autoHold: null, held: 0, touched: true, scrolled: true };
    detail.setMode('user');
    requestDraw();
  }
  // "Show me": the run goes to the start of that layer and plays
  function jumpTo(li) {
    if (S.zoom) { S.zoom = null; detail.close(); }
    if (mq.matches && sheet && sheet.open) sheet.setOpen(false);
    const stop = tour.stopOf(li);
    tour.seek(stop ? stop.t0 : 0);
    tour.playing = true;
    S.segI = -1; S.userScrollAt = -1e9;
    requestDraw();
  }

  // the zoom panel: its final box (the column or block at f = 1), and where
  // it is now (between the map it comes from and that box)
  function placeZoom(reduced) {
    const z = S.zoom;
    if (!z || !detail.isOpen) return;
    const final = S.Lfull && S.Lfull.zoom;
    if (!final) return;
    const from = zoomFrom(S.Lbase, z.spec.li, z.spec.c, S.result.top);
    const now = lerpRect(from, final, z.f);
    detail.place(final, now, z.f, reduced);
    S.zoomRect = { final, now, f: z.f };
    // phone: scroll the open block into view once
    if (S.L.orient === 'v' && !z.scrolled && z.f > 0) { z.scrolled = true; followTo(final.y - 40, reduced); }
  }

  // ── overview canvas ──────────────────────────────────────────────────────
  function relayout() {
    const phone = mq.matches;
    const w = Math.max(240, wrap.clientWidth || (phone ? 360 : 1100));
    const h = phone ? 0 : Math.max(300, wrap.clientHeight || 640);
    S.base = { w, h, orient: phone || w < 720 ? 'v' : 'h' };
    // a narrow desktop stage also gets the tall blocks layout: then the
    // stage must scroll as it does on a phone (style.css body.net-v)
    doc.body.classList.toggle('net-v', S.base.orient === 'v' && !phone);
    S.dpr = Math.min(2, win.devicePixelRatio || 1);
    S.cw = w; S.ch = -1; S.fullKey = '';
    layoutNow();
    requestDraw();
  }
  // the zoom height on a phone: what is left of the screen under the bars
  function phoneZoomH() {
    const stage = $('stage'), head = $('stageHead');
    const vis = (stage.clientHeight || 0) - (head ? head.offsetHeight || 0 : 0);
    return Math.round(Math.max(440, Math.min(700, (vis || 520) - 24)));
  }
  // the layout of this frame: the plain one, the one with the zoom fully
  // open (the final box of the panel), and the one at the zoom's f
  function layoutNow() {
    if (!S.base) return;
    const { w, h, orient } = S.base, z = S.zoom;
    S.Lbase = layoutNet(w, h, orient);
    if (z) {
      const ex = { li: z.spec.li, h: orient === 'v' ? phoneZoomH() : 0 };
      const key = `${w}x${h}${orient}:${ex.li}:${ex.h}`;
      if (S.fullKey !== key) { S.Lfull = layoutNet(w, h, orient, { expand: { ...ex, f: 1 } }); S.fullKey = key; }
      S.L = z.f > 0 ? layoutNet(w, h, orient, { expand: { ...ex, f: z.f } }) : S.Lbase;
    } else { S.L = S.Lbase; S.Lfull = null; S.fullKey = ''; }
    // canvas size: on a phone it is as tall as the blocks (with the zoom,
    // as tall as the open layout, so it does not change size every frame)
    const ch = orient === 'v' ? (z ? S.Lfull.h : S.Lbase.h) : h;
    if (ch !== S.ch) {
      S.ch = ch;
      if (orient === 'v') { cv.style.height = ch + 'px'; wrap.style.height = ch + 'px'; } else { cv.style.height = ''; wrap.style.height = ''; }
      cv.width = Math.round(w * S.dpr); cv.height = Math.round(ch * S.dpr);
    }
  }
  function busy() {
    const z = S.zoom;
    if (tour.playing) return true;
    if (z && z.mode === 'user') return z.f !== z.target || z.autoHold != null || detail.playing;
    return false;
  }
  function requestDraw() { if (!S.raf) S.raf = win.requestAnimationFrame(frame); }
  function frame(now) {
    S.raf = 0;
    const dt = S.last ? Math.min(0.1, Math.max(0, (now - S.last) / 1000)) : 1 / 60;
    S.last = now;
    advance(dt);
    if (busy()) S.raf = win.requestAnimationFrame(frame);
    else S.last = 0;
  }
  function drawNet() {
    if (!g || !S.L || !S.result) return;
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    g.clearRect(0, 0, S.cw, S.ch);
    const showFocus = doc.activeElement === cv || (S.zoom && S.zoom.mode === 'user');
    const fs = flowState(plan, tour.t);
    const flow = fs.ended ? null : { li: fs.li, k: fs.k, time: S.time, reduced: !!rm.matches };
    const z = S.zoom && S.zoom.f > 0 ? { li: S.zoom.spec.li, f: S.zoom.f } : null;
    const out = drawNetwork(g, S.L, { maps, result: S.result, hover: S.zoom ? null : S.hover, focus: showFocus ? S.focus : null,
      flow, zoom: z, barT: fs.barT, win: fs.win });
    S.bars = out && out.bars;
    S.drawn = (S.drawn || 0) + 1;
  }

  function cellValue(li, c, gy, gx) {
    const L = S.result.layers[li];
    return li === 0 ? L.data[(gy * 64 + gx) * 3 + Math.max(0, c)] : L.data[(gy * L.W + gx) * L.C + c];
  }
  function tipText(h) {
    if (h.kind === 'bar') return `${CLASSES[h.i]} · <b>${(S.result.probs[h.i] * 100).toFixed(2)}%</b>`;
    const name = ARCH[h.li].label, ch = h.li === 0 ? (h.c < 0 ? 'picture' : ['red', 'green', 'blue'][h.c]) : `map ${h.c + 1}`;
    if (h.li === 0 && h.c < 0) {
      const v = [0, 1, 2].map(k => Math.round(cellValue(0, k, h.gy, h.gx) * 255));
      return `${name} · ${ch} · (${h.gy}, ${h.gx}) <b>${v.join(' ')}</b>`;
    }
    return `${name} · ${ch} · (${h.gy}, ${h.gx}) <b>${cellValue(h.li, h.c, h.gy, h.gx).toFixed(3)}</b>`;
  }
  function onPointer(e) {
    if (!S.L || !S.result) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hitTest(S.L, x, y);
    const key = h ? JSON.stringify(h) : '';
    if (key !== S.hoverKey) { S.hoverKey = key; S.hover = h; requestDraw(); }
    if (h && e.pointerType !== 'touch') {
      tip.hidden = false; tip.innerHTML = tipText(h);
      const tw = tip.offsetWidth || 160;
      tip.style.left = Math.min(r.width - tw - 6, x + 14) + 'px'; tip.style.top = (y + 16) + 'px';
    } else tip.hidden = true;
  }
  function columnAt(L, x, y) {
    if (L.orient === 'h') { const c = L.cols.find(q => x >= q.x && x < q.x + q.w); return c && y < L.h - 6 ? c.li : -1; }
    const c = L.cols.find(q => q.li < 11 && y >= q.y && y < q.y + (L.title || 0) + (q.rowH || 0));
    return c ? c.li : -1;
  }
  function onLeave() { S.hover = null; S.hoverKey = ''; tip.hidden = true; requestDraw(); }
  function onClick(e) {
    if (!S.L) return;
    const r = cv.getBoundingClientRect(), h = hitTest(S.L, e.clientX - r.left, e.clientY - r.top);
    if (!h) {
      // a click on a column (its title or the space between its maps)
      // zooms into its busiest map; anywhere else it closes the zoom
      const li = S.zoom ? -1 : columnAt(S.L, e.clientX - r.left, e.clientY - r.top);
      if (li >= 0) openZoom({ li, c: li === 0 ? -1 : li === 11 ? null : busyMap(S.result, li, 0) });
      else if (S.zoom) closeZoom();
      return;
    }
    if (h.kind === 'bar') openZoom({ li: 11, c: h.i });
    else openZoom({ li: h.li, c: h.c, gy: h.gy, gx: h.gx });
  }
  // keyboard: Left and Right move between layers, Up and Down between maps
  function onKey(e) {
    const f = S.focus.bar != null ? { li: 11, c: S.focus.bar } : { li: S.focus.li, c: S.focus.c };
    let { li, c } = f;
    const n = l => (l === 0 ? 4 : 10), idx = l => (l === 0 ? c + 1 : c);
    if (e.key === 'ArrowRight') { li = Math.min(11, li + 1); c = Math.min(9, Math.max(0, li === 0 ? c : c)); }
    else if (e.key === 'ArrowLeft') { li = Math.max(0, li - 1); if (li === 0) c = Math.min(2, Math.max(-1, c)); }
    else if (e.key === 'ArrowDown') { const k = Math.min(n(li) - 1, idx(li) + 1); c = li === 0 ? k - 1 : k; }
    else if (e.key === 'ArrowUp') { const k = Math.max(0, idx(li) - 1); c = li === 0 ? k - 1 : k; }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openZoom({ li, c }, { auto: false }); return; }
    else return;
    e.preventDefault();
    if (li !== 0 && c < 0) c = 0;
    S.focus = li === 11 ? { bar: Math.max(0, c) } : { li, c };
    const what = li === 11 ? `Output, ${CLASSES[Math.max(0, c)]}, ${(S.result.probs[Math.max(0, c)] * 100).toFixed(1)} percent`
      : li === 0 ? `Input, ${c < 0 ? 'the picture' : ['red', 'green', 'blue'][c] + ' channel'}` : `${ARCH[li].label}, map ${c + 1} of 10, ${GRID[li]} by ${GRID[li]}`;
    live.textContent = what + '. Enter zooms into it.';
    requestDraw();
  }
  cv.addEventListener('pointermove', onPointer);
  cv.addEventListener('pointerleave', onLeave);
  cv.addEventListener('click', onClick);
  cv.addEventListener('keydown', onKey);
  cv.addEventListener('focus', requestDraw);
  cv.addEventListener('blur', requestDraw);
  doc.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('viewPop').hidden) toggleView(false);
      else if (!$('credits').hidden) closeCredits();
      else if (S.zoom) { closeZoom(); cv.focus && cv.focus(); }
    }
  });
  for (const ev of ['wheel', 'touchmove']) $('stage').addEventListener(ev, () => { S.userScrollAt = performanceNow(); }, { passive: true });
  if ('ResizeObserver' in win) new win.ResizeObserver(() => relayout()).observe(wrap);
  win.addEventListener('resize', relayout);
  if (mq.addEventListener) mq.addEventListener('change', relayout);

  // ── photo strip, upload and camera ──────────────────────────────────────
  function thumb(rgb, size = 64) {
    const c2 = doc.createElement('canvas'); c2.width = size; c2.height = size;
    const x = c2.getContext('2d');
    if (x) { const id = x.createImageData(64, 64); rgbToRGBA(rgb, id.data); x.putImageData(id, 0, 0); }
    return c2;
  }
  function buildStrip() {
    const host = $('stripEx');
    EXAMPLES.forEach((ex, i) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'ex-btn'; b.dataset.i = i;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', `${ex.cls}, example ${i % 2 + 1}`);
      b.title = `${ex.cls} · photo: ${ex.author} (${ex.licence})`;
      b.appendChild(thumb(exampleRGB(S.bin, i)));
      b.addEventListener('click', () => runExample(i));
      host.appendChild(b);
    });
    $('upload').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { runOwn(await fileToRGB(f), 'your photo'); } catch (err) { toast('That file did not open as a picture.'); }
    });
    $('camBtn').addEventListener('click', openCam);
    $('camCancel').addEventListener('click', closeCam);
    $('camTake').addEventListener('click', takeCam);
    $('dockPhotos').addEventListener('click', () => { $('stage').scrollTo ? $('stage').scrollTo({ top: 0, behavior: 'smooth' }) : 0; const b = host.querySelector('[aria-checked="true"]') || host.firstChild; b && b.focus(); });
  }
  function markStrip() {
    for (const b of $('stripEx').querySelectorAll('.ex-btn')) b.setAttribute('aria-checked', String(!S.own && +b.dataset.i === S.pick));
    const own = $('stripEx').querySelector('.own'); if (own) own.setAttribute('aria-checked', String(!!S.own));
  }
  function runOwn(rgb, name) {
    S.own = rgb;
    let b = $('stripEx').querySelector('.own');
    if (!b) {
      b = doc.createElement('button'); b.type = 'button'; b.className = 'ex-btn own'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Your picture');
      b.addEventListener('click', () => { if (S.own) { markStrip(); run(S.own); } });
      $('stripEx').prepend(b);
    }
    b.replaceChildren(thumb(rgb));
    markStrip();
    run(rgb, { label: name });
  }
  async function fileToRGB(file) {
    let src, w, h;
    if (win.createImageBitmap) { src = await win.createImageBitmap(file); w = src.width; h = src.height; }
    else {
      src = await new Promise((res, rej) => { const im = new win.Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    return sourceToRGB(src, w, h);
  }
  function sourceToRGB(src, w, h) {
    const k = Math.min(1, 512 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
    const c2 = doc.createElement('canvas'); c2.width = cw; c2.height = chh;
    const x = c2.getContext('2d'); x.drawImage(src, 0, 0, cw, chh);
    return coverResample(x.getImageData(0, 0, cw, chh).data, cw, chh, 64);
  }
  let camStream = null;
  async function openCam() {
    const md = win.navigator.mediaDevices;
    if (!md || !md.getUserMedia) { const u = $('upload'); u.setAttribute('capture', 'environment'); u.click(); u.removeAttribute('capture'); return; }
    try {
      camStream = await md.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      const v = $('camVideo'); v.srcObject = camStream; await v.play().catch(() => {});
      $('cam').hidden = false; $('camTake').focus();
    } catch (e) { toast('The camera is not available. Pick a photo instead.'); }
  }
  function closeCam() { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; $('cam').hidden = true; $('camBtn').focus(); }
  function takeCam() {
    const v = $('camVideo');
    if (v.videoWidth) runOwn(sourceToRGB(v, v.videoWidth, v.videoHeight), 'your snapshot');
    closeCam();
  }

  // ── colours pop-up ──────────────────────────────────────────────────────
  function buildView() {
    mountGradientPicker($('gradHost'), { value: S.grad, reversed: S.rev, label: 'Choose a gradient',
      ids: ['magma', 'inferno', 'viridis', 'plasma', 'cividis', 'turbo', 'ice', 'ember', 'aurora', 'mono'],
      onChange(id, rev) { S.grad = id; S.rev = rev; applyColours(); } });
    const seg = $('scaleSeg');
    for (const s of SCALES) {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = s.label; b.dataset.id = s.id; b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { S.scale = s.id; applyColours(); });
      seg.appendChild(b);
    }
    markScale();
    $('viewBtn').addEventListener('click', () => toggleView());
    $('dockView').addEventListener('click', () => toggleView());
  }
  function markScale() { for (const b of $('scaleSeg').children) { const on = b.dataset.id === S.scale; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } }
  function applyColours() {
    maps.set(null, { grad: S.grad, rev: S.rev, scale: S.scale });
    markScale(); store(false, { grad: S.grad, rev: S.rev, scale: S.scale });
    explain.refresh(); if (detail.isOpen) detail.refresh(); requestDraw();
  }
  function toggleView(on) {
    const p = $('viewPop'); on = on == null ? p.hidden : on;
    p.hidden = !on;
    $('viewBtn').setAttribute('aria-expanded', String(on)); $('dockView').setAttribute('aria-expanded', String(on));
    if (on) { const f = p.querySelector('.gg-sw.on') || p.querySelector('button'); f && f.focus(); }
  }
  doc.addEventListener('pointerdown', e => {
    const p = $('viewPop');
    if (!p.hidden && !p.contains(e.target) && e.target !== $('viewBtn') && e.target !== $('dockView')) toggleView(false);
  });

  // ── the run bar: play, step, speed, scrubber ──────────────────────────────
  function buildTourBar() {
    const track = $('tTrack');
    S.tsegs = plan.stops.map(st => {
      const d = doc.createElement('div'); d.className = 't-seg'; d.style.flexGrow = String(st.t1 - st.t0);
      d.title = ARCH[st.li].label;
      const f = doc.createElement('div'); f.className = 't-fill';
      const sp = doc.createElement('span'); sp.textContent = SHORT[st.li];
      d.append(f, sp); track.appendChild(d);
      return { el: d, fill: f, st };
    });
    $('tPlay').addEventListener('click', togglePlay);
    $('tPrev').addEventListener('click', () => stepRun(-1));
    $('tNext').addEventListener('click', () => stepRun(1));
    $('tSpeed').addEventListener('change', e => { tour.speed = +e.target.value || 1; });
    let drag = null;
    const seekX = e => {
      const r = track.getBoundingClientRect(), w = r.width || 1;
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / w)) * plan.total;
      dropUserZoom(); tour.seek(t); S.segI = -1; requestDraw();
    };
    track.addEventListener('pointerdown', e => {
      drag = { was: tour.playing || (S.zoom && S.zoom.mode === 'user' && S.zoom.wasPlaying) };
      tour.pause();
      if (track.setPointerCapture && e.pointerId != null) { try { track.setPointerCapture(e.pointerId); } catch (err) { /* not a real pointer */ } }
      seekX(e);
    });
    track.addEventListener('pointermove', e => { if (drag) seekX(e); });
    const up = () => { if (!drag) return; if (drag.was && !tour.ended) tour.playing = true; drag = null; requestDraw(); };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') stepRun(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') stepRun(-1);
      else if (e.key === 'Home') { dropUserZoom(); tour.seek(0); S.segI = -1; }
      else if (e.key === 'End') { dropUserZoom(); tour.seek(plan.total); S.segI = -1; }
      else if (e.key === ' ' || e.key === 'Enter') togglePlay();
      else return;
      e.preventDefault(); requestDraw();
    });
  }
  // a zoom of the reader ends at once (a seek or a step of the run)
  function dropUserZoom() { if (S.zoom && S.zoom.mode === 'user') { S.zoom = null; detail.close(); } }
  function togglePlay() {
    const z = S.zoom;
    if (z && z.mode === 'user') { z.wasPlaying = true; z.target = 0; }
    else if (tour.playing) tour.pause();
    else { tour.play(); S.segI = tour.t === 0 ? -1 : S.segI; }
    requestDraw();
  }
  function stepRun(d) { dropUserZoom(); tour.step(d); S.segI = -1; S.userScrollAt = -1e9; requestDraw(); }
  function updateTourBar() {
    const t = tour.t, playing = tour.playing || (S.zoom && S.zoom.mode === 'user' && S.zoom.wasPlaying && S.zoom.target === 0);
    for (const q of S.tsegs) {
      const k = Math.max(0, Math.min(1, (t - q.st.t0) / (q.st.t1 - q.st.t0)));
      const w = (k * 100).toFixed(1) + '%';
      if (q.w !== w) { q.w = w; q.fill.style.width = w; }
      const on = t >= q.st.t0 && (t < q.st.t1 || (q === S.tsegs[S.tsegs.length - 1]));
      if (q.on !== on) { q.on = on; q.el.classList.toggle('on', on); }
    }
    const tr = $('tTrack'), pc = String(Math.round(t / plan.total * 100));
    if (tr.getAttribute('aria-valuenow') !== pc) {
      tr.setAttribute('aria-valuenow', pc);
      const at = tour.at();
      tr.setAttribute('aria-valuetext', tour.ended ? 'The end: the answer' : `${ARCH[at.seg.li].label}, ${pc} percent`);
    }
    const label = tour.ended ? 'replay' : playing ? 'pause' : 'play';
    if (S.playLabel !== label) {
      S.playLabel = label;
      const b = $('tPlay');
      b.textContent = label === 'replay' ? '↻' : label === 'pause' ? '❚❚' : '▶';
      b.setAttribute('aria-label', label === 'replay' ? 'Play the run again' : label === 'pause' ? 'Pause the run' : 'Play the run');
      b.classList.toggle('replay', label === 'replay');
    }
    doc.body.classList.toggle('run-on', !tour.ended);
  }

  // ── credits ──────────────────────────────────────────────────────────────
  function buildCredits() {
    const b = $('creditsBody');
    const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    b.innerHTML = `
      <p>This page shows <a href="${SOURCE.repo}" target="_blank" rel="noopener">CNN Explainer</a> by ${esc(SOURCE.authors)}:
      “${esc(SOURCE.title)}”, ${esc(SOURCE.venue)}.
      <a href="${SOURCE.doi}" target="_blank" rel="noopener">DOI</a> ·
      <a href="${SOURCE.arxiv}" target="_blank" rel="noopener">arXiv</a> ·
      <a href="${SOURCE.live}" target="_blank" rel="noopener">their live demo</a>.</p>
      <h3>What we use</h3>
      <ul>
        <li>Their trained Tiny VGG weights (model/weights.bin), byte for byte, under the MIT licence of the repository (${esc(SOURCE.licence)}). The full notice is in CREDITS.md next to this page.</li>
        <li>Their network design and the ten class names.</li>
      </ul>
      <p>The layout, the drawings, the text and the code are our own. The forward pass is plain JavaScript, not TensorFlow.js. A node check gave the same top class as the original model on all 21 of its example pictures, with probabilities within 1.1 × 10⁻⁶.</p>
      <h3>What we do not use</h3>
      <p>Their example photos are 64 × 64 Tiny ImageNet pictures that the authors do not own, so this page uses its own public-domain and CC0 photos from Wikimedia Commons. We chose photos that the network gets right; it is wrong on many others. Their fonts, icons and interface code are not used.</p>
      <h3>Example photos</h3>
      <div class="cr-photos"></div>
      <p>Your own photo or camera picture stays in your browser.</p>`;
    const grid = b.querySelector('.cr-photos');
    EXAMPLES.forEach((ex, i) => {
      grid.appendChild(thumb(exampleRGB(S.bin, i)));
      const s = doc.createElement('span');
      s.innerHTML = `${esc(ex.cls)} · <a href="${esc(ex.url)}" target="_blank" rel="noopener">${esc(ex.file)}</a> · ${esc(ex.author)} · ${esc(ex.licence)}`;
      grid.appendChild(s);
    });
    $('creditsBtn').addEventListener('click', () => ($('credits').hidden ? openCredits() : closeCredits()));
    $('creditsClose').addEventListener('click', closeCredits);
  }
  function openCredits() { $('credits').hidden = false; $('creditsBtn').setAttribute('aria-expanded', 'true'); $('creditsClose').focus(); }
  function closeCredits() { $('credits').hidden = true; $('creditsBtn').setAttribute('aria-expanded', 'false'); $('creditsBtn').focus(); }

  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; win.clearTimeout(toastT); toastT = win.setTimeout(() => { t.hidden = true; }, 3200); }

  // ── go ───────────────────────────────────────────────────────────────────
  relayout();
  runExample(DEFAULT_EXAMPLE);
  advance(0);
  S.booted = true;
  // SAVER SEAM: window.snSaver (saver.js) borrows maps, draw and scenes.
  installSaver(page, { doc, win });
  return page;
}

if (typeof window !== 'undefined' && !window.__cnnNoAutoBoot) {
  boot().catch(e => { console.error('cnn-explainer: boot', e); });
}
