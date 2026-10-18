// ============================================================================
//  CORAL REEF  ·  squad-hud.js  ·  ROV selection, feed cards, tags, minimap
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should be able to see the camera from all
//  three ROV's on the right side and a minimap on the bottom left of what
//  they've explored so far. we should be able to select each ROV
//  individually and highlight it with this menu" (the camera bar).
//
//  ONE SELECTION. sel is the id of the selected ROV (1 to 4). select(id)
//  sets it everywhere in one call: the ROV group of the camera bar
//  (#rovPick), the main feed card (the large card; rov/feeds.js gives it
//  the most live frames), the 3D tag (#rovTags: corner marks round the
//  vehicle and its id and task), the minimap arrow, and through o.onSelect
//  the follow camera of main.js. Keys 1 to 4 select too. Each ROV has one
//  colour on all of them (rov/hud.js ROV_COLOURS).
//
//  FEED CARDS (#feed > #feedSlot > .fcard). One card per ROV in id order,
//  at the right; the selected card is large, the others small (hud.js
//  compact). feedLayout() gives the card widths so the stack fits under
//  the readout. A tap on a small card selects its ROV. Phones show the
//  selected card only, with tabs (#feedTabs) and a swipe to change it; a
//  tap on the card makes it large (#feedSize). The saver shows the main
//  card only, at the cardRect place of saver.js (main.js placeCard sets the
//  style of #feed). present() draws the live pictures after the main
//  render; only the feeds whose cards show are active (no renders else).
//
//  MINIMAP (#minimap, minimap.js). 4 redraws a second, centred on the
//  selected ROV; the fog buffer paints each new visited cell once. A tap
//  sends the selected ROV to that point when the squad has goTo(id, [x,
//  z]) (WORLD, NOTES.md); else it says that the squad takes no waypoints
//  yet. +, - and the wheel zoom (120 m to 960 m across); the fold button
//  hides it (phones start folded).
//
//    const H = mountSquadHud({ doc, win, THREE, canvas, camera: () => S.camera,
//      getSquad, getRovs, getField, getCam, surfaceY, phoneQ, isSaver,
//      feedOn: () => G.feed, onSelect(id, { follow }), flash(msg) });
//    H.setRovs(rovs)   after createROVs (bar buttons, cards, tags)
//    H.select(id, { follow = true })   H.selectNext(+1 | -1)   H.selected
//    H.tick(dt)        each frame (tags; minimap at 4 Hz)
//    H.present()       each frame after the main render (live pictures)
//    H.debug()         state for the tests
//
//  grep -n targets
//    "export function feedLayout"    the card widths (pure)
//    "export function vehicleTask"   the task text of each ROV (pure)
//    "export function mountSquadHud"
//    "  function select("  "  function buildBar"  "  function buildCards"
//    "  function placeTags"  "  function drawMap"  "  function present"
// ============================================================================
import { rovColour } from './rov/hud.js';
import { createFogMap, drawMinimap, coneOf, mapToWorld, SPANS } from './minimap.js';

const CARD_AR = 322 / 352;           // rov/hud.js HUD.H / HUD.W

// The card widths (CSS px). vw, vh: the window; n: the cards; top: the
// first free y at the right (under the readout); bottom: the margin.
// Desktop: the main card about 0.27 vw (at most 352), the small cards 0.6
// of it; both scale down so the stack fits. Phone: one card.
export function feedLayout({ vw, vh, n, top = 0, bottom = 14, phone = false, gap = 8 }) {
  if (phone) return { main: Math.min(150, vw * 0.4), thumb: 0, one: true };
  const A = Math.max(120, vh - top - bottom);
  let wm = Math.min(352, Math.max(220, vw * 0.27)), wt = Math.round(wm * 0.6);
  const need = (a, b) => CARD_AR * (a + (n - 1) * b) + gap * (n - 1);
  if (need(wm, wt) > A) { const k = (A - gap * (n - 1)) / (CARD_AR * (wm + (n - 1) * wt)); wm *= k; wt *= k; }
  return { main: Math.round(Math.max(150, wm)), thumb: Math.round(Math.max(96, wt)), one: false, height: Math.round(need(Math.max(150, wm), Math.max(96, wt))) };
}

// The task text of vehicle i: the leader has the squad task; the others
// say what they do.
export function vehicleTask(squad, i) {
  if (!squad || !squad.vehicles[i]) return '';
  if (i === 0) return squad.task ? squad.task.label : 'surveying';
  const st = squad.vehicles[i].state;
  return st.mode === 'inspect' ? 'lighting the colony' : `following ROV ${squad.vehicles[0].id}`;
}

export function mountSquadHud(o) {
  const doc = o.doc, win = o.win || doc.defaultView;
  const $ = (id) => doc.getElementById(id);
  const phone = () => !!(o.phoneQ && o.phoneQ.matches);
  let sel = 1, rovs = null, frameN = 0, mapT = 0, trailT = 0, labT = 0, zoom = 1, fold = phone();
  let rects = new Map(), op = 1;
  const trails = new Map();          // id -> [[x, z], ...]
  const mm = { fog: null, squad: null, W: null, known: -1, target: null, arrows: [], last: null };
  const V3 = o.THREE ? new o.THREE.Vector3() : null;

  const ids = () => (rovs && rovs.vehicles ? rovs.vehicles.map(v => v.id) : []);
  const indexOf = (id) => ids().indexOf(id);

  // ── selection ─────────────────────────────────────────────────────────────
  function select(id, opt = {}) {
    const all = ids();
    if (!all.length) { sel = id; return false; }
    if (!all.includes(id)) return false;
    sel = id;
    if (rovs && rovs.feed && rovs.feed.setVehicle) rovs.feed.setVehicle(id);
    if (rovs && typeof rovs.setHighlight === 'function') rovs.setHighlight(id, rovColour(id));   // ROV-LOOK: a rim glow (NOTES.md)
    syncSelection();
    mapT = 1;                        // redraw the map now
    if (o.onSelect) o.onSelect(id, { follow: opt.follow !== false, source: opt.source || 'api' });
    return true;
  }
  function selectNext(d = 1) {
    const all = ids(); if (!all.length) return false;
    const i = all.indexOf(sel);
    return select(all[((i < 0 ? 0 : i) + d + all.length) % all.length], { source: 'next' });
  }
  function syncSelection() {
    for (const b of doc.querySelectorAll('#rovPick button')) {
      const s = +b.dataset.rov === sel;
      b.classList.toggle('sel', s);
    }
    for (const c of doc.querySelectorAll('#feedSlot .fcard')) {
      const s = +c.dataset.rov === sel;
      c.classList.toggle('main', s);
      const pk = c.querySelector('.fpick');
      if (pk) pk.setAttribute('aria-pressed', String(s));
    }
    for (const t of doc.querySelectorAll('#feedTabs button')) {
      const s = +t.dataset.rov === sel;
      t.classList.toggle('on', s); t.setAttribute('aria-selected', String(s)); t.tabIndex = s ? 0 : -1;
    }
    for (const t of doc.querySelectorAll('#rovTags .rtag')) t.classList.toggle('sel', +t.dataset.rov === sel);
    // the size button lives on the main card
    const fs = $('feedSize'), mc = doc.querySelector(`#feedSlot .fcard[data-rov="${sel}"]`);
    if (fs && mc && fs.parentNode !== mc) mc.appendChild(fs);
    layout();
    frameN = 0;
  }

  // ── the camera bar group ──────────────────────────────────────────────────
  function buildBar() {
    const g = $('rovPick'); if (!g) return;
    g.innerHTML = '';
    for (const id of ids()) {
      const b = doc.createElement('button');
      b.type = 'button'; b.dataset.cam = 'follow'; b.dataset.rov = String(id);
      b.style.setProperty('--c', rovColour(id));
      b.title = `ROV ${id} (key ${id}): select it, follow it with the camera and make its feed the main card`;
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-keyshortcuts', String(id));
      const dot = doc.createElement('i'); dot.className = 'rdot'; dot.setAttribute('aria-hidden', 'true');
      const sp = doc.createElement('span'); sp.innerHTML = `<em>ROV </em>${id}`;
      b.append(dot, sp);
      b.addEventListener('click', () => select(id, { source: 'bar' }));
      g.appendChild(b);
    }
  }

  // ── the feed cards ────────────────────────────────────────────────────────
  function buildCards() {
    const slot = $('feedSlot'), tabs = $('feedTabs'), fs = $('feedSize');
    if (!slot) return;
    if (fs && fs.parentNode !== $('feed')) $('feed').appendChild(fs);
    slot.innerHTML = '';
    if (tabs) tabs.innerHTML = '';
    const set = rovs && rovs.feed;
    for (const id of ids()) {
      const f = set && set.feedOf ? set.feedOf(id) : (set && id === ids()[0] ? set : null);
      const c = doc.createElement('div');
      c.className = 'fcard'; c.dataset.rov = String(id); c.style.setProperty('--c', rovColour(id));
      if (f && f.canvas) { f.canvas.setAttribute('aria-hidden', 'true'); c.appendChild(f.canvas); }
      const pk = doc.createElement('button');
      pk.type = 'button'; pk.className = 'fpick';
      pk.setAttribute('aria-label', `ROV ${id} camera: select ROV ${id}`);
      pk.setAttribute('aria-pressed', 'false');
      bindCardInput(pk, id);
      c.appendChild(pk);
      slot.appendChild(c);
      if (tabs) {
        const t = doc.createElement('button');
        t.type = 'button'; t.dataset.rov = String(id); t.setAttribute('role', 'tab'); t.style.setProperty('--c', rovColour(id));
        t.setAttribute('aria-label', `ROV ${id} camera`); t.textContent = String(id);
        t.addEventListener('click', () => select(id, { source: 'tab' }));
        tabs.appendChild(t);
      }
    }
  }
  // desktop: a tap selects; phone: a tap makes the card large, a swipe
  // selects the next or the last ROV
  function bindCardInput(el, id) {
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
      if (phone() && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { el.dataset.swiped = '1'; selectNext(dx < 0 ? 1 : -1); }
    });
    el.addEventListener('click', () => {
      if (el.dataset.swiped) { delete el.dataset.swiped; return; }
      if (!phone() && id !== sel) { select(id, { source: 'card' }); return; }
      // the main card (and on a phone the one card): large or small
      const fs = $('feedSize'); if (fs) fs.click();
    });
  }
  function layout() {
    const f = $('feed'); if (!f) return;
    const vw = win.innerWidth || 1280, vh = win.innerHeight || 720, rd = $('read');
    let top = 70;
    try { const r = rd && rd.getBoundingClientRect(); if (r && r.bottom > 0) top = r.bottom + 10; } catch { /* no layout */ }
    const L = feedLayout({ vw, vh, n: Math.max(1, ids().length), top, bottom: 14, phone: phone() });
    // on #feedSlot: the saver exit clears the style of #feed
    const sl = $('feedSlot');
    if (sl) { sl.style.setProperty('--fc-main', `${L.main}px`); sl.style.setProperty('--fc-thumb', `${L.thumb}px`); }
    f.classList.toggle('one', L.one);
    mm.layout = L;
  }

  // ── live pictures (after the main render) ─────────────────────────────────
  function present() {
    const set = rovs && rovs.feed;
    if (!set || !set.feedOf) return;
    const f = $('feed');
    if ((frameN++ % 10) === 0) {
      rects = new Map();
      const vis = !!(o.feedOn() && f && !f.hidden);
      op = 1;
      const shown = [];
      if (vis) {
        op = parseFloat(win.getComputedStyle(f).opacity); if (!(op >= 0)) op = 1;
        const cr = o.canvas.getBoundingClientRect();
        // one card (phone, a large card, the saver): the main card only
        const one = phone() || f.classList.contains('big') || o.isSaver();
        for (const c of f.querySelectorAll('.fcard')) {
          const id = +c.dataset.rov, cs = win.getComputedStyle(c);
          if ((one && id !== sel) || cs.display === 'none' || cs.visibility === 'hidden') continue;
          shown.push(id);
          const cv = c.querySelector('canvas'), fd = set.feedOf(id);
          if (!cv || !fd) continue;
          const r = cv.getBoundingClientRect();
          if (r.width >= 4) rects.set(id, fd.pictureRect({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }));
        }
      }
      set.setActiveIds(shown);
      set.setActive(vis && op > 0.01);
      if (f) f.classList.toggle('live', !!set.live);
    }
    if (!set.live) return;
    for (const [id, r] of rects) { const fd = set.feedOf(id); if (fd) fd.present(r, op); }
  }

  // ── 3D tags ───────────────────────────────────────────────────────────────
  function buildTags() {
    const box = $('rovTags'); if (!box) return;
    box.innerHTML = '';
    for (const id of ids()) {
      const t = doc.createElement('div');
      t.className = 'rtag'; t.dataset.rov = String(id); t.style.setProperty('--c', rovColour(id));
      t.innerHTML = `<span class="brk"></span><span class="lbl"><b>ROV ${id}</b><i></i></span>`;
      box.appendChild(t);
    }
  }
  function placeTags(dt) {
    const box = $('rovTags'); if (!box || !rovs || !V3) return;
    const cam = o.camera(); if (!cam) return;
    const w = o.canvas.clientWidth || 1, h = o.canvas.clientHeight || 1;
    const sq = o.getSquad();
    const label = (labT += dt) > 0.5; if (label) labT = 0;
    const tan = Math.tan((cam.fov || 50) * Math.PI / 360);
    for (const t of box.children) {
      const id = +t.dataset.rov, v = rovs.vehicles.find(q => q.id === id);
      if (!v || o.isSaver()) { t.style.display = 'none'; continue; }
      v.group.getWorldPosition(V3);
      const d = V3.distanceTo(cam.position);
      V3.project(cam);
      if (V3.z > 1 || V3.z < -1 || Math.abs(V3.x) > 1.3 || Math.abs(V3.y) > 1.3) { t.style.display = 'none'; continue; }
      const x = (V3.x + 1) / 2 * w, y = (1 - V3.y) / 2 * h;
      const r = Math.max(10, Math.min(140, 0.9 * h / (2 * tan * Math.max(0.1, d))));
      t.style.display = '';
      t.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      t.style.setProperty('--r', `${r.toFixed(1)}px`);
      // a near selected ROV (the follow camera) keeps only a quiet label
      t.classList.toggle('near', r > 90);
      if (label && sq) { const i = sq.vehicles.findIndex(q => q.id === id); const lb = t.querySelector('i'); if (lb) lb.textContent = vehicleTask(sq, i); }
    }
  }

  // ── the minimap ───────────────────────────────────────────────────────────
  function bindMap() {
    const box = $('minimap'), cv = $('mmCanvas');
    if (!box || !cv) return;
    box.classList.toggle('fold', fold);
    const fb = $('mmFold');
    if (fb) { fb.setAttribute('aria-expanded', String(!fold)); fb.addEventListener('click', () => { fold = !fold; box.classList.toggle('fold', fold); fb.setAttribute('aria-expanded', String(!fold)); mapT = 1; }); }
    const z = (d) => { zoom = Math.max(0, Math.min(SPANS.length - 1, zoom + d)); mapT = 1; const zl = $('mmZoom'); if (zl) zl.textContent = `${SPANS[zoom]} m`; };
    const zi = $('mmIn'), zo = $('mmOut');
    if (zi) zi.addEventListener('click', () => z(-1));
    if (zo) zo.addEventListener('click', () => z(1));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); z(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    let down = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || !mm.view) { down = null; return; }
      down = null;
      const r = cv.getBoundingClientRect();
      sendTo(mapToWorld(e.clientX - r.left, e.clientY - r.top, mm.view));
    });
  }
  function sendTo(xz) {
    const sq = o.getSquad();
    if (!sq) return false;
    if (typeof sq.goTo === 'function') {
      const okk = sq.goTo(sel, xz);
      if (okk !== false) { mm.target = xz.slice(); mapT = 1; o.flash(`ROV ${sel}: going to the point on the map.`); return true; }
      o.flash(`ROV ${sel} cannot go there.`); return false;
    }
    o.flash('The squad takes no waypoints yet: it picks its own route.');
    return false;
  }
  function drawMap() {
    const cv = $('mmCanvas'), sq = o.getSquad(), W = o.getField();
    if (!cv || !sq || !W || !rovs) return null;
    if (sq !== mm.squad || W !== mm.W) {
      mm.squad = sq; mm.W = W; mm.known = -1; mm.target = null; trails.clear();
      mm.fog = createFogMap({ ground: (x, z) => W.ground(x, z), region: W.regionAt ? (x, z) => W.regionAt(x, z) : null, surfaceY: o.surfaceY, doc });
    }
    const i = Math.max(0, sq.vehicles.findIndex(v => v.id === sel)), L = sq.vehicles[i].state;
    const span = SPANS[zoom];
    const cw = cv.clientWidth || 200, ch = cv.clientHeight || 200, dpr = Math.min(2, win.devicePixelRatio || 1);
    if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const view = { cx: L.p[0], cz: L.p[2], k: cw / span, w: cw, h: ch };
    mm.view = view;
    const F = mm.fog, vis = sq.visited;
    F.follow(view.cx, view.cz, span * 0.75, vis ? vis.keys() : null);
    if (vis && vis.size !== mm.known) { for (const k of vis.keys()) F.add(k); mm.known = vis.size; }
    F.work(2);
    const ctx = cv.getContext ? cv.getContext('2d') : null;
    const cam = o.getCam();
    const rv = sq.vehicles.map(v => ({ id: v.id, p: v.state.p, yaw: v.state.yaw, colour: rovColour(v.id), trail: trails.get(v.id) || [], sel: v.id === sel }));
    const rg = W.regionAt ? W.regionAt(L.p[0], L.p[2]) : null;
    const st = {
      w: cw, h: ch, view, fog: F, rovs: rv,
      cone: cam ? coneOf(cam.eye, cam.look, 2 * Math.atan(Math.tan((o.camera() ? o.camera().fov : 50) * Math.PI / 360) * (o.canvas.clientWidth || 1) / (o.canvas.clientHeight || 1)), span * 0.18) : null,
      target: mm.target, title: `ROV ${sel}${rg ? ' · ' + rg.name : ''}`, titleColour: rovColour(sel), sub: `${Math.round(o.surfaceY - L.p[1])} m deep`,
    };
    mm.last = st;
    if (!ctx) return st;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = drawMinimap(ctx, st);
    mm.arrows = r.arrows;
    cv.setAttribute('aria-label', `Map of the explored seafloor, north up, ${span} m across: ${F.painted.size} cells of 12 m explored here. ROV ${sel} is selected, ${st.sub}${rg ? ' in the ' + rg.name : ''}.`);
    return st;
  }
  function stepTrails() {
    const sq = o.getSquad(); if (!sq) return;
    for (const v of sq.vehicles) {
      let T = trails.get(v.id); if (!T) { T = []; trails.set(v.id, T); }
      const p = [v.state.p[0], v.state.p[2]], q = T[T.length - 1];
      if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) > 60) T.length = 0;   // a jump (a region move)
      T.push(p); if (T.length > 40) T.shift();
    }
  }

  function tick(dt) {
    placeTags(dt);
    if ((trailT += dt) > 1.5) { trailT = 0; stepTrails(); }
    if ((mapT += dt) > 0.25) { mapT = 0; if (!fold && !o.isSaver()) drawMap(); }
  }

  // keys 1 to 4 (no text field, no modifier, not in the saver)
  const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')); };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e) || o.isSaver()) return;
    const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code || '') || (/^[1-4]$/.test(e.key || '') ? [0, e.key] : null);
    if (!m) return;
    if (select(+m[1], { source: 'key' })) e.preventDefault();
  }
  win.addEventListener('keydown', onKey);
  if (o.phoneQ && o.phoneQ.addEventListener) o.phoneQ.addEventListener('change', () => { layout(); frameN = 0; });
  win.addEventListener('resize', layout);
  bindMap();

  function setRovs(r) {
    rovs = r;
    const all = ids();
    if (all.length && !all.includes(sel)) sel = all[0];
    buildBar(); buildCards(); buildTags();
    if (rovs && rovs.feed && rovs.feed.setVehicle) rovs.feed.setVehicle(sel);
    syncSelection();
  }

  return {
    get selected() { return sel; },
    select, selectNext, setRovs, tick, present, layout, sendTo, drawMap,
    colourOf: rovColour,
    debug() {
      const set = rovs && rovs.feed;
      return {
        sel, ids: ids(), cards: [...doc.querySelectorAll('#feedSlot .fcard')].map(c => +c.dataset.rov),
        mainCard: (doc.querySelector('#feedSlot .fcard.main') || { dataset: {} }).dataset.rov,
        barSel: [...doc.querySelectorAll('#rovPick button.sel')].map(b => +b.dataset.rov),
        tagSel: [...doc.querySelectorAll('#rovTags .rtag.sel')].map(b => +b.dataset.rov),
        feedMain: set ? set.vehicle : null, feedStats: set && set.stats ? JSON.parse(JSON.stringify(set.stats)) : null,
        map: mm.last ? { arrows: mm.arrows.slice(), painted: mm.fog ? mm.fog.painted.size : 0, view: Object.assign({}, mm.view), selArrow: (mm.last.rovs.find(r => r.sel) || {}).id } : null,
        layout: mm.layout || null, fold, zoom: SPANS[zoom],
      };
    },
  };
}
