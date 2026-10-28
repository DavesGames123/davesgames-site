// ============================================================================
//  EM EXPLORER  ·  saver/director.js — the shot director (SAVER)
// ----------------------------------------------------------------------------
//  createDirector(deps) -> { start(), stop(), debug(), plan }
//  The director plays the shot plan (saver/plan.js) on the live page. It has
//  no DOM and no clock of its own: saver/index.js gives it the browser
//  parts, and saver/tests.mjs gives it a fake page and a fake clock.
//
//  deps
//    em        window.__em (CORE): catalog, state(), volume(),
//              selectDataset(id, { view })
//    viewer    the VIEW viewer: goTo, setContrast, autoContrast,
//              saverShots { flyTo, prefetch, isReady }
//    label     (info) -> void, the shell plate (opts.label), or null
//    box       () -> clearBox (plan.js), the clear box now
//    now       () -> ms;  wait(ms) -> Promise;  frame() -> Promise (one frame)
//    calm      0..1 (1 slowest);  seed  the plan seed
//    onVeil    (k) -> void, k 0..1 black over the canvas (DOM veil)
//    text      { placeTitle, creditLine, fmtVoxel, fmtLength } (ui/*)
//
//  One shot, on a cut (a new dataset or a new plane):
//    fade to black (veil and contrast crush) -> plate text -> selectDataset
//    or goTo the start view -> wait for tiles (5 s at most) -> the contrast
//    window -> flight, with the fade in over its start -> hold (push in and drift, with a
//    prefetch of the next shot) -> a short wait for the next tiles.
//  Without a cut: plate text -> flight -> hold -> wait.
//
//  grep -n targets
//    fades ............ "async function fade"
//    a cut ............ "async function cut"
//    one shot ......... "async function playShot"
//    the loop ......... "async function play"
// ============================================================================
import {
  shotPlan, shotTarget, startView, holdTarget, flightLength, shotTiming, crush, planeRes, rng,
} from './plan.js';

export function createDirector(deps) {
  const { em, viewer, label, box, now, wait, frame, onVeil } = deps;
  const calm = Math.max(0, Math.min(1, deps.calm == null ? 0.7 : +deps.calm));
  const T = deps.text;
  const cat = em.catalog || { datasets: [], bookmarks: [] };
  const dsOf = (id) => cat.datasets.find((d) => d.id === id) || null;
  const bmOf = (id) => cat.bookmarks.find((b) => b.id === id) || null;
  const known = cat.bookmarks.filter((b) => dsOf(b.dataset) && Array.isArray(dsOf(b.dataset).voxel));
  const plan = shotPlan(known, deps.seed, 64);
  const r = rng((deps.seed >>> 0) ^ 0x9e3779b9);
  const shots = viewer.saverShots;

  const st = {
    alive: false, i: 0, shot: null, phase: 'idle', veil: 1, win: { lo: 0, hi: 1 }, gamma: 1, winFor: null,
    errors: 0, failed: new Set(), lastErr: '', shown: 0, log: [],
  };
  const FADE_OUT = Math.round(700 + 400 * calm), FADE_IN = Math.round(900 + 500 * calm);

  function note(kind, extra) { if (st.log.length < 400) st.log.push({ t: now(), kind, i: st.i, ...extra }); }

  function applyVeil() {
    try { onVeil && onVeil(st.veil); } catch (e) { /* DOM */ }
    const c = crush(st.win, st.veil);
    try { viewer.setContrast(c.lo, c.hi, st.gamma); } catch (e) { /* VIEW */ }
  }

  async function fade(to, ms) {
    const from = st.veil, t0 = now();
    for (;;) {
      if (!st.alive) return;
      const k = ms > 0 ? Math.min(1, (now() - t0) / ms) : 1;
      st.veil = from + (to - from) * k;
      applyVeil();
      if (k >= 1) return;
      await frame();
    }
  }

  async function until(test, ms, poke) {
    const t0 = now();
    while (st.alive && now() - t0 < ms) {
      let ok = false;
      try { ok = test(); } catch (e) { ok = true; }
      if (ok) return true;
      if (poke) { try { poke(); } catch (e) { /* VIEW */ } }
      await wait(120);
    }
    return false;
  }

  // a promise that VIEW might never settle (a page that went away)
  function settle(p, ms) {
    return Promise.race([Promise.resolve(p).catch(() => false), wait(ms).then(() => false)]);
  }

  function fieldText(tg, d, b) {
    const npp = planeRes(d.voxel, tg.plane) / tg.zoom;
    return T.fmtLength(b.w * npp);
  }

  function say(b, d, tg, bx) {
    if (typeof label !== 'function') return;
    const sub = [d.name || d.short || d.id, T.fmtVoxel(d.voxel) && `${T.fmtVoxel(d.voxel)} voxels`].filter(Boolean).join(' · ');
    const lines = [b.caption, `Field of view ${fieldText(tg, d, bx)} across`, 'Data: ' + T.creditLine(d)].filter(Boolean);
    try {
      label({
        title: T.placeTitle(b), sub, lines,
        anchor: () => { const q = box(); return { x: q.cx, y: q.cy, r: Math.round(0.3 * Math.min(q.w, q.h)), lead: false }; },
      });
    } catch (e) { /* the plate is optional */ }
  }

  function stateNow() { try { return em.state() || {}; } catch (e) { return {}; } }

  // The contrast window of a new volume: the catalog window if the record
  // has one, else VIEW's auto window (percentiles of the coarse tiles).
  async function windowFor(d) {
    const c = d.contrast;
    if (c && Number.isFinite(c.lo) && Number.isFinite(c.hi) && c.hi > c.lo) {
      const s = c.hi > 1 ? 255 : 1;
      st.win = { lo: c.lo / s, hi: c.hi / s }; st.gamma = Number.isFinite(c.gamma) ? c.gamma : 1;
    } else {
      let a = null;
      await until(() => { a = viewer.autoContrast ? viewer.autoContrast() : { lo: 0, hi: 1 }; return !!a; }, 2500);
      if (!st.alive) return;
      st.win = a ? { lo: a.lo, hi: a.hi } : { lo: 0, hi: 1 }; st.gamma = 1;
    }
    st.winFor = d.id;
    applyVeil();
  }

  async function cut(shot, b, d) {
    st.phase = 'fade-out';
    await fade(1, FADE_OUT);
    if (!st.alive) return false;
    let bx = box();
    say(b, d, shotTarget(b, d, bx), bx);
    const sv = startView(d.home, b, bx);
    const here = stateNow().dataset;
    st.phase = 'switch';
    note('cut', { cut: shot.cut, dataset: d.id, view: sv });
    if (here !== d.id || !em.volume()) {
      let ok = false;
      try { ok = await em.selectDataset(d.id, { view: sv }); } catch (e) { st.lastErr = String(e); }
      // CORE set its own contrast: go black again before the next frame
      applyVeil();
      if (!ok || !st.alive) { if (st.alive) { st.errors++; st.failed.add(d.id); note('fail', { dataset: d.id }); } return false; }
    } else {
      try { viewer.goTo(sv); } catch (e) { st.lastErr = String(e); }
      applyVeil();
    }
    st.phase = 'load';
    await until(() => shots.isReady(sv) >= 0.85, 5000, () => shots.prefetch(sv));
    if (!st.alive) return false;
    if (st.winFor !== d.id) await windowFor(d);
    if (!st.alive) return false;
    return true;
  }

  async function playShot(shot) {
    const b = bmOf(shot.id), d = b && dsOf(b.dataset);
    if (!b || !d || st.failed.has(d.id)) return false;
    st.shot = shot;
    const here = stateNow();
    const isCut = !!shot.cut || here.dataset !== d.id || !em.volume() || st.winFor !== d.id;
    if (isCut) {
      if (!(await cut(shot, b, d))) return false;
    }
    let bx = box();
    const tg = shotTarget(b, d, bx);
    if (!isCut) say(b, d, tg, bx);
    const v = viewer.state ? viewer.state() : null;
    const S = v && v.nm && v.plane === tg.plane ? flightLength(v, tg, d, bx) : 2;
    // the fade in runs during the flight, so it is part of the shot time
    const tm = shotTiming(S, calm, r(), 0);
    const t0 = now();
    note('shot', { id: b.id, dataset: d.id, cut: isCut ? shot.cut || 'dataset' : null, S, ...tm, target: tg });
    st.shown++;
    st.phase = 'fly';
    const flight = shots.flyTo(tg, { ms: tm.flyMs });
    if (isCut) await fade(0, FADE_IN);
    await settle(flight, tm.flyMs + 1500);
    if (!st.alive) return true;
    // the hold: push in and drift; meanwhile load the next shot
    const nx = plan[(st.i + 1) % plan.length], nb = nx && bmOf(nx.id);
    const nextTg = nb && !nx.cut && nb.dataset === d.id ? shotTarget(nb, d, box()) : null;
    st.phase = 'hold';
    const hold = shots.flyTo(holdTarget(tg, d, bx, r(), r()), { ms: tm.holdMs });
    if (nextTg) { try { shots.prefetch(nextTg); } catch (e) { /* VIEW */ } }
    await settle(hold, tm.holdMs + 1500);
    if (nextTg && st.alive) {
      st.phase = 'wait';
      const left = Math.max(0, 12000 - (now() - t0));
      await until(() => shots.isReady(nextTg) >= 0.6, Math.min(left, tm.extraMs + 400), () => shots.prefetch(nextTg));
    }
    note('end', { id: b.id, ms: now() - t0 });
    return true;
  }

  async function play() {
    let miss = 0;
    while (st.alive) {
      if (!plan.length) { st.phase = 'empty'; return; }
      const shot = plan[st.i % plan.length];
      let ok = false;
      try { ok = await playShot(shot); } catch (e) { st.errors++; st.lastErr = String((e && e.message) || e); }
      st.i++;
      miss = ok ? 0 : miss + 1;
      if (miss >= plan.length) {
        // nothing loads (offline): wait under black, then try every dataset again
        st.phase = 'offline';
        await wait(8000);
        st.failed.clear(); miss = 0;
      }
    }
  }

  return {
    plan,
    start() { if (st.alive) return; st.alive = true; st.veil = 1; applyVeil(); st.done = play(); return st.done; },
    stop() { st.alive = false; return st.done; },
    debug() {
      const s = st.shot;
      return { i: st.i, id: s && s.id, dataset: s && s.dataset, phase: st.phase, shown: st.shown, errors: st.errors, failed: [...st.failed], lastErr: st.lastErr, veil: st.veil, win: { ...st.win } };
    },
    log: st.log,
  };
}
