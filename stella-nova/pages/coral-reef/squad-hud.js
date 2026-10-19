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
//  at the right; the selected card is large (landscape: 0.24 of the 3D
//  view width at M, the group 0.34 of it or less; portrait: 0.32 of the
//  window width), the others in a column at its left (hud.js compact), or
//  tabs when the view is narrow. feedLayout() gives the
//  card widths so the stack fits under the readout and right of the
//  minimap; #feedTools > #feedScale sets S, M or L (localStorage). A tap on a small card selects its ROV. Phones show the
//  selected card only, with tabs (#feedTabs) and a swipe to change it; a
//  tap on the card makes it large (#feedSize). The saver shows the main
//  card only, at the cardRect place of saver.js (main.js placeCard sets the
//  style of #feed). present() draws the live pictures after the main
//  render; only the feeds whose cards show are active (no renders else).
//
//  CYCLE (#feedCycle, key C; off by default, localStorage). Every 25 s
//  the selection goes to the next ROV through select(), so the bar, the
//  cards, the tags, the minimap and the follow camera (a glide, no snap)
//  agree. A hand selection starts the dwell again; a hand camera input
//  (drag, wheel, move keys, Orbit, Swim, Tours) stops it for a minute of
//  no input. The saver hides the button and does not cycle.
//
//  MINIMAP (#minimap, minimap.js). 4 redraws a second, centred on the
//  selected ROV; the fog buffer paints each new visited cell once. A click
//  or a tap (or Enter, or the key M) opens the large map (map-view.js
//  mountExploreMap, #xmap): there a click sends the selected ROV with
//  sendTo (squad.goTo(id, [x, z])) or moves the camera. +, - and the
//  wheel zoom (120 m to 960 m across); the fold button hides it (phones
//  start folded).
//
//    const H = mountSquadHud({ doc, win, THREE, canvas, camera: () => S.camera,
//      getSquad, getRovs, getField, getCam, surfaceY, phoneQ, isSaver,
//      feedOn: () => G.feed, onSelect(id, { follow }), flash(msg),
//      onCardTap(id) -> true when it took the tap (manual.js: back to auto) });
//    H.setRovs(rovs)   after createROVs (bar buttons, cards, tags)
//    H.select(id, { follow = true })   H.selectNext(+1 | -1)   H.selected
//    H.tick(dt)        each frame (tags; minimap at 4 Hz)
//    H.present()       each frame after the main render (live pictures)
//    H.map             the large map (map-view.js); H.mapCovers() is true
//                      while it is open (main.js draws no 3D frame then)
//    H.debug()         state for the tests
//
//  grep -n targets
//    "export function feedLayout"    the card widths (pure)
//    "export function feedRects"     the card rects of a layout (pure)
//    "  function buildTools"  "  function setFeedSize"
//    "export function createCycle"   the Cycle mode (pure)  "  function setCycle"
//    "export function vehicleTask"   the task text of each ROV (pure)
//    "export function mountSquadHud"
//    "  function select("  "  function buildBar"  "  function buildCards"
//    "  function placeTags"  "  function drawMap"  "  function present"
// ============================================================================
import { rovColour } from './rov/hud.js';
import { createFogMap, drawMinimap, coneOf, SPANS } from './minimap.js';
import { mountExploreMap } from './map-view.js';

const CARD_AR = 322 / 352;           // rov/hud.js HUD.H / HUD.W

// The card widths (CSS px). vw, vh: the window; n: the cards; top: the
// first free y at the right (under the readout); bottom, right: the
// margins of #feed; left: the first free x at the left (the right edge of
// the minimap and a gap); size: the S/M/L choice of #feedScale; view: the
// visible part of the 3D view ({ x, w }: the window less the open panel).
// The user said (2026-10-18): "the rov's feeds need to be bigger".
// PORTRAIT (the window is higher than wide): the main card is
// FEED_SIZES[size] of the window width (M: 0.32) at the right, the other
// cards in a column at its left (hud.css grid), 0.62 of it or less, so
// that the column fits under the readout and the tool row (#feedTools).
// When the two columns do not fit right of the minimap, both scale down.
// LANDSCAPE (the window). The user said (2026-10-18): "the amount of space the ROV
// layer takes up is too considerable in this layout. in the veritcal
// layout it's alright". The main card is FEED_VIEW[size] of the VIEW
// width (M: 0.24), the other cards a narrow column (FEED_THUMB of the
// view width), and the group is FEED_GROUP of the view width or less, at
// its right. When the column falls under FEED_THUMB_MIN px, the other
// cards collapse to the tabs (one: true, as on a phone).
// PHONE: one card, FEED_PHONE[size] of the width.
export const FEED_SIZES = { S: 0.26, M: 0.32, L: 0.38 };
export const FEED_VIEW = { S: 0.19, M: 0.24, L: 0.28 };
export const FEED_GROUP = 0.34, FEED_THUMB = 0.09, FEED_THUMB_MIN = 80;
export const FEED_PHONE = { S: 0.4, M: 0.58, L: 0.8 };
export const FEED_TOOLS_H = 34;
export function feedLayout({ vw, vh, n, top = 0, bottom = 12, right = 12, left = 0, phone = false, gap = 8, size = 'M', view = null }) {
  const sz = FEED_SIZES[size] ? size : 'M';
  if (phone) {
    const main = Math.round(Math.max(120, Math.min(vw * FEED_PHONE[sz], vw - 16, (vh * 0.45) / CARD_AR)));
    return { main, thumb: 0, one: true, size: sz, width: main, height: Math.round(main * CARD_AR) };
  }
  const A = Math.max(160, vh - top - bottom - FEED_TOOLS_H), m = Math.max(0, n - 1);
  const vwid = Math.max(1, view && view.w > 0 ? view.w : vw);
  if (vw > vh) {
    // a landscape window: the group stays in the right FEED_GROUP of the view
    const vx = view && view.w > 0 ? (view.x || 0) : 0;
    const cap = Math.min(vwid * FEED_GROUP, vw - right - Math.max(left, vx + vwid * (1 - FEED_GROUP)));
    let main = Math.min(vwid * FEED_VIEW[sz], A / CARD_AR, cap);
    let thumb = m ? Math.min(vwid * FEED_THUMB, main, (A - gap * (m - 1)) / (m * CARD_AR)) : 0;
    if (m && main + gap + thumb > cap) { const k = (cap - gap) / (main + thumb); main *= k; thumb *= k; }
    const one = m > 0 && thumb < FEED_THUMB_MIN;
    if (one) { thumb = 0; main = Math.min(vwid * FEED_VIEW[sz], A / CARD_AR, cap); }
    main = Math.round(Math.max(120, main)); thumb = Math.round(thumb);
    const colH = thumb ? m * thumb * CARD_AR + gap * (m - 1) : 0;
    return { main, thumb, one, size: sz, width: main + (thumb ? gap + thumb : 0), height: Math.round(Math.max(main * CARD_AR, colH)) };
  }
  let main = Math.min(vw * FEED_SIZES[sz], A / CARD_AR, 900);
  let thumb = m ? Math.min(main * 0.62, (A - gap * (m - 1)) / (m * CARD_AR)) : 0;
  const room = vw - right - left;
  if (main + (m ? gap + thumb : 0) > room) { const k = Math.max(0.3, (room - (m ? gap : 0)) / (main + thumb)); main *= k; thumb *= k; }
  main = Math.round(Math.max(150, main)); thumb = m ? Math.round(Math.max(96, thumb)) : 0;
  const colH = m ? m * thumb * CARD_AR + gap * (m - 1) : 0;
  return { main, thumb, one: false, size: sz, width: main + (m ? gap + thumb : 0), height: Math.round(Math.max(main * CARD_AR, colH)) };
}

// The rects of the cards in window px (x, y, w, h), as hud.css places
// them: #feed at right / bottom, the main card at the upper right of the
// grid, the other cards in the left column; the tool row on top.
export function feedRects(L, { vw, vh, n, bottom = 12, right = 12, gap = 8 }) {
  const x1 = vw - right, y0 = vh - bottom - L.height, out = { tools: { x: x1 - L.width, y: y0 - FEED_TOOLS_H, w: L.width, h: FEED_TOOLS_H }, cards: [] };
  out.cards.push({ main: true, x: x1 - L.main, y: y0, w: L.main, h: L.main * CARD_AR });
  if (!L.one) for (let i = 0; i < n - 1; i++) out.cards.push({ main: false, x: x1 - L.width, y: y0 + i * (L.thumb * CARD_AR + gap), w: L.thumb, h: L.thumb * CARD_AR });
  return out;
}

// The task text of vehicle i: the leader has the squad task; the others
// say what they do.
export function vehicleTask(squad, i) {
  if (!squad || !squad.vehicles[i]) return '';
  if (squad.isManual && squad.isManual(squad.vehicles[i].id)) return 'manual control';
  if (i === 0) return squad.task ? squad.task.label : 'surveying';
  // the spread squad: each ROV has a task of its own (rov/squad.js tasks)
  if (squad.spread && typeof squad.tasks === 'function') { const t = squad.tasks()[i]; if (t) return t.label; }
  const st = squad.vehicles[i].state;
  return st.mode === 'inspect' ? 'lighting the colony' : `following ROV ${squad.vehicles[0].id}`;
}

// CYCLE. The user said (2026-10-18): "we should have a mode where we can
// just slowly swap back and forth between rovers (cycle button above the
// camers)". When on, step(dt) returns true each dwell (s): the HUD then
// selects the next ROV. picked() (a hand selection) starts the dwell again.
// input() (a camera input by hand) stops the cycle until idle s pass with
// no input, or until the cycle is set again.
export const CYCLE_DWELL = 25, CYCLE_IDLE = 60;
export function createCycle({ dwell = CYCLE_DWELL, idle = CYCLE_IDLE } = {}) {
  const c = { on: false, t: 0, pause: 0, dwell, idle };
  c.set = (on) => { c.on = !!on; c.t = 0; c.pause = 0; };
  c.picked = () => { c.t = 0; };
  c.input = () => { if (c.on) c.pause = c.idle; };
  c.step = (dt) => {
    if (!c.on) return false;
    if (c.pause > 0) { c.pause = Math.max(0, c.pause - dt); if (c.pause === 0) c.t = 0; return false; }
    if ((c.t += dt) >= c.dwell) { c.t = 0; return true; }
    return false;
  };
  return c;
}

export function mountSquadHud(o) {
  const doc = o.doc, win = o.win || doc.defaultView;
  const $ = (id) => doc.getElementById(id);
  const phone = () => !!(o.phoneQ && o.phoneQ.matches);
  let sel = 1, rovs = null, frameN = 0, mapT = 0, trailT = 0, labT = 0, zoom = 1, fold = phone();
  let rects = new Map(), op = 1;
  const cyc = createCycle(o.cycle || {});
  let cycling = false;
  const trails = new Map();          // id -> [[x, z], ...]
  const mm = { fog: null, squad: null, W: null, known: -1, target: null, arrows: [], last: null };
  let big = null;                    // map-view.js: the large map (a click on the minimap or M)
  const V3 = o.THREE ? new o.THREE.Vector3() : null;

  const ids = () => (rovs && rovs.vehicles ? rovs.vehicles.map(v => v.id) : []);
  const indexOf = (id) => ids().indexOf(id);

  // ── selection ─────────────────────────────────────────────────────────────
  function select(id, opt = {}) {
    const all = ids();
    if (!all.length) { sel = id; return false; }
    if (!all.includes(id)) return false;
    sel = id;
    if (!cycling) cyc.picked();      // a hand selection: the dwell starts again
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
      // the card of the ROV in control mode: back to auto (manual.js)
      if (o.onCardTap && o.onCardTap(id)) return;
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
    // the first free x: right of the minimap (open, not in the saver)
    let left = 0;
    try { const mb = $('minimap'), r = mb && !mb.classList.contains('fold') && mb.getBoundingClientRect(); if (r && r.width > 0) left = r.right + 12; } catch { /* no layout */ }
    // the visible 3D view: the canvas less the open panel at the left
    let view = { x: 0, w: vw };
    try {
      const cr = o.canvas && o.canvas.getBoundingClientRect(); if (cr && cr.width > 0) view = { x: cr.left, w: cr.width };
      const pn = $('panel'), pr = pn && !doc.body.classList.contains('panel-closed') && pn.getBoundingClientRect();
      if (pr && pr.width > 0 && pr.right > view.x && pr.right < view.x + view.w) view = { x: pr.right, w: view.x + view.w - pr.right };
    } catch { /* no layout */ }
    const L = feedLayout({ vw, vh, n: Math.max(1, ids().length), top, bottom: 12, left, phone: phone(), size: feedSize, view });
    // on #feedSlot: the saver exit clears the style of #feed
    const sl = $('feedSlot');
    if (sl) { sl.style.setProperty('--fc-main', `${L.main}px`); sl.style.setProperty('--fc-thumb', `${L.thumb}px`); }
    f.classList.toggle('one', L.one);
    mm.layout = L;
  }

  // ── the tool row over the cards (#feedTools): the card size S, M, L ─────
  // kept in localStorage 'coral-reef-feed-size' (M: the main card 0.24 of
  // the view width, portrait 0.32 of the window width). The saver hides the row (hud.css).
  const FS = ['S', 'M', 'L'], FS_NAMES = { S: 'small', M: 'medium', L: 'large' };
  let feedSize = 'M';
  try { const v = win.localStorage.getItem('coral-reef-feed-size'); if (FS.includes(v)) feedSize = v; } catch { /* private mode: the default */ }
  function buildTools() {
    const f = $('feed'); if (!f || $('feedTools')) return;
    const row = doc.createElement('div'); row.id = 'feedTools'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Camera cards');
    const b = doc.createElement('button'); b.type = 'button'; b.id = 'feedScale';
    b.addEventListener('click', () => setFeedSize(FS[(FS.indexOf(feedSize) + 1) % FS.length], true));
    const cb = doc.createElement('button'); cb.type = 'button'; cb.id = 'feedCycle'; cb.textContent = 'Cycle';
    cb.title = `Cycle (C): select the next ROV every ${cyc.dwell} s, the camera glides to it`;
    cb.addEventListener('click', () => setCycle(!cyc.on, true));
    row.append(cb, b);
    f.insertBefore(row, f.firstChild);
    setFeedSize(feedSize, false);
    setCycle(cycOn, false);
  }
  // the cycle: off by default, kept in localStorage 'coral-reef-feed-cycle'
  let cycOn = false;
  try { cycOn = win.localStorage.getItem('coral-reef-feed-cycle') === '1'; } catch { /* private mode: off */ }
  function setCycle(on, keep) {
    cycOn = !!on; cyc.set(cycOn);
    const cb = $('feedCycle');
    if (cb) { cb.setAttribute('aria-pressed', String(cycOn)); cb.classList.toggle('on', cycOn); }
    if (keep) {
      try { win.localStorage.setItem('coral-reef-feed-cycle', cycOn ? '1' : '0'); } catch { /* not kept */ }
      if (o.flash) o.flash(cycOn ? `Cycle on: the next ROV every ${cyc.dwell} s.` : 'Cycle off.');
    }
  }
  function cycleStep(dt) {
    if (o.isSaver() || (big && big.covers()) || ids().length < 2) return;
    if (!cyc.step(dt)) return;
    const all = ids(), i = all.indexOf(sel);
    cycling = true;
    try { select(all[((i < 0 ? 0 : i) + 1) % all.length], { source: 'api' }); } finally { cycling = false; }
  }
  // a camera input by hand stops the cycle for a minute of no input
  const camInput = () => cyc.input();
  if (o.canvas && o.canvas.addEventListener) for (const ev of ['pointerdown', 'wheel', 'touchstart']) o.canvas.addEventListener(ev, camInput, { passive: true });
  const cbar = $('camBar');
  if (cbar) cbar.addEventListener('click', (e) => { const t = e.target && e.target.closest && e.target.closest('button[data-cam]'); if (t && t.dataset.cam !== 'follow') camInput(); }, true);
  const MOVE = /^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Space)$/;
  function setFeedSize(v, keep) {
    feedSize = FS.includes(v) ? v : 'M';
    const b = $('feedScale');
    if (b) { b.textContent = feedSize; b.title = `Card size: ${FS_NAMES[feedSize]}. Press to change (small, medium, large)`; b.setAttribute('aria-label', b.title); }
    if (keep) { try { win.localStorage.setItem('coral-reef-feed-size', feedSize); } catch { /* not kept */ } }
    layout(); frameN = 0;
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
        const one = phone() || f.classList.contains('one') || f.classList.contains('big') || o.isSaver();
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
    // the size of the minimap: S, M (the default) or L, kept in localStorage
    // (the user: "the minimap on the rov's needs to be bigger")
    const SIZES = ['s', 'm', 'l'], NAMES = { s: 'small', m: 'medium', l: 'large' };
    let size = 'm';
    try { const v = win.localStorage.getItem('coral-reef-minimap-size'); if (SIZES.includes(v)) size = v; } catch { /* private mode: the default */ }
    const setSize = (v) => {
      size = v;
      for (const k of SIZES) box.classList.toggle('mm-' + k, k === v);
      const sb = $('mmSize');
      if (sb) { sb.textContent = v.toUpperCase(); sb.setAttribute('aria-label', `Map size: ${NAMES[v]}. Press to change (small, medium, large)`); }
      mapT = 1;
    };
    setSize(size);
    const sb = $('mmSize');
    if (sb) sb.addEventListener('click', () => {
      setSize(SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]);
      win.setTimeout(layout, 260);   // the feed keeps clear of the new map size
      try { win.localStorage.setItem('coral-reef-minimap-size', size); } catch { /* not kept */ }
    });
    const xb = $('mmExpand');
    if (xb) xb.addEventListener('click', () => { if (big) big.open(); });
    mm.size = () => size;
    const zi = $('mmIn'), zo = $('mmOut');
    if (zi) zi.addEventListener('click', () => z(-1));
    if (zo) zo.addEventListener('click', () => z(1));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); z(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    // a click or a tap opens the large map (map-view.js); Enter and Space too
    cv.tabIndex = 0;
    cv.setAttribute('role', 'button'); cv.setAttribute('aria-haspopup', 'dialog'); cv.setAttribute('aria-keyshortcuts', 'M');
    cv.style.cursor = 'zoom-in';
    const hint = doc.createElement('span'); hint.className = 'mm-hint'; hint.setAttribute('aria-hidden', 'true'); hint.textContent = win.matchMedia && win.matchMedia('(pointer:coarse)').matches ? 'Tap to expand' : 'Click to expand · M';
    box.appendChild(hint);
    let down = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      if (big) big.open();
    });
    cv.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && big) { e.preventDefault(); big.open(); } });
  }
  function sendTo(xz) {
    const sq = o.getSquad();
    if (!sq) return false;
    if (typeof sq.goTo === 'function') {
      const okk = sq.goTo(sel, xz);
      if (okk !== false) { mm.target = xz.slice(); mapT = 1; if (big) big.noteTarget(sel, xz); o.flash(`ROV ${sel}: going to the point on the map.`); return true; }
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
    const cw = cv.clientWidth || 200, ch = cv.clientHeight || 200, dpr = Math.min(3, win.devicePixelRatio || 1);
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
    // the discoveries (discoveries.js marks): icons, hover, click to orbit
    if (o.marks) { try { o.marks.draw(ctx, view, 'mini'); } catch (e) { console.error('coral-reef: minimap marks', e); } }
    mm.arrows = r.arrows;
    cv.setAttribute('aria-label', `Map of the explored seafloor, north up, ${span} m across: ${F.painted.size} cells of 12 m explored here. ROV ${sel} is selected, ${st.sub}${rg ? ' in the ' + rg.name : ''}. Click, or press Enter or M, to open the large map.`);
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
    cycleStep(dt);
    if ((trailT += dt) > 1.5) { trailT = 0; stepTrails(); }
    if ((mapT += dt) > 0.25) { mapT = 0; if (!fold && !o.isSaver()) drawMap(); }
    if (big) big.tick(dt);
    // the large map covers the view: the ROV feeds rest too (present() wakes them)
    if (big && big.covers() && rovs && rovs.feed && rovs.feed.setActive) { rovs.feed.setActive(false); frameN = 0; }
  }

  // keys 1 to 4 (no text field, no modifier, not in the saver)
  const typing = (e) => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')); };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e) || o.isSaver()) return;
    if (MOVE.test(e.code || '')) camInput();
    // C: the cycle (in Swim, C is the swim down key of input.js)
    if (e.code === 'KeyC') { const cm = o.getCam ? o.getCam() : null; if (!cm || cm.mode !== 'swim') { setCycle(!cyc.on, true); e.preventDefault(); } return; }
    const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code || '') || (/^[1-4]$/.test(e.key || '') ? [0, e.key] : null);
    if (!m) return;
    if (select(+m[1], { source: 'key' })) e.preventDefault();
  }
  win.addEventListener('keydown', onKey);
  if (o.phoneQ && o.phoneQ.addEventListener) o.phoneQ.addEventListener('change', () => { layout(); frameN = 0; });
  win.addEventListener('resize', layout);
  // the panel opens or closes: the view width changes (sn-panel.js)
  try { if (win.MutationObserver) new win.MutationObserver(layout).observe(doc.body, { attributes: true, attributeFilter: ['class'] }); } catch { /* no observer */ }
  bindMap();
  big = mountExploreMap({
    doc, win, getSquad: o.getSquad, getField: o.getField, getCam: o.getCam, camera: o.camera, canvas: o.canvas,
    surfaceY: o.surfaceY, phoneQ: o.phoneQ, isSaver: o.isSaver, flash: o.flash,
    hud: { selected: () => sel, select: (id, opt) => select(id, opt), sendTo: (xz) => sendTo(xz), colourOf: rovColour },
    goRegion: o.goRegion, moveCam: o.moveCam, colonies: o.colonies, speciesLabel: o.speciesLabel, marks: o.marks,
    onOpen: () => { if (rovs && rovs.feed && rovs.feed.setActive) rovs.feed.setActive(false); frameN = 0; },
  });

  function setRovs(r) {
    rovs = r;
    const all = ids();
    if (all.length && !all.includes(sel)) sel = all[0];
    buildTools(); buildBar(); buildCards(); buildTags();
    if (rovs && rovs.feed && rovs.feed.setVehicle) rovs.feed.setVehicle(sel);
    syncSelection();
  }

  return {
    get selected() { return sel; },
    select, selectNext, setRovs, tick, present, layout, sendTo, drawMap, setFeedSize, setCycle, cycle: cyc,
    map: big, mapCovers: () => !!big && big.covers(),
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
        layout: mm.layout || null, feedSize, cycle: { on: cyc.on, t: cyc.t, pause: cyc.pause }, fold, zoom: SPANS[zoom], size: mm.size ? mm.size() : null, big: big ? big.debug() : null,
      };
    },
  };
}
