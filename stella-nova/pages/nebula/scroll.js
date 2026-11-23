// ============================================================================
//  NEBULA  ·  scroll.js — the one scroll value of the strip
// ----------------------------------------------------------------------------
//  From the star map artifact (js/ui/scroll.js, row A11), with two changes:
//    1. A drag that ends while it moves keeps going (a fling) with an
//       exponential slow-down, so a phone swipe travels along the nebula.
//    2. attachTrack(el) replaces the minimap: a thin track where a press or
//       a drag puts the view there.
//
//  createScroller(el, { contentW, getViewW, onScroll, onInput })
//    -> { set(t), jump(t), get(), getT(), panBy(dx), settled(), attachTrack(el), dispose() }
//    set(t)    moves the target to t (0..1 of the range contentW - viewW); a spring follows
//    jump(t)   sets the value at once (the saver uses it)
//    get()     the smoothed scroll in content px; getT() the same as 0..1
//    onInput() runs on each user input (the page hides its hint and stops the saver tour)
//
//  Input: wheel (vertical or horizontal delta, 1 canvas unit per delta px),
//  pointer drag, arrow keys, PageUp / PageDown, Home / End.
//  One critically damped spring (time constant 140 ms) moves the value.
//  Reduced motion: the value jumps to the target and a fling does not run.
//
//  grep -n targets: "function step", "function onWheel", "function onPointer", "FLING"
// ============================================================================
const TAU_MS = 140;
// FLING: a release faster than MIN px/s (CSS) keeps going; the speed falls
// as exp(-t / TAU) (a total travel of v * TAU).
const FLING = { MIN: 120, TAU: 0.35 };

export function createScroller(el, opts) {
  const contentW = opts.contentW || 5760;
  const getViewW = opts.getViewW;
  const onScroll = opts.onScroll || (() => {});
  const onInput = opts.onInput || (() => {});
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }

  let value = 0, target = 0, vel = 0, raf = 0, last = 0;
  const range = () => Math.max(1, contentW - getViewW());
  const clampT = (t) => Math.min(1, Math.max(0, t));
  const emit = () => onScroll(value * range(), value);

  function step(now) {
    const total = Math.min(1, Math.max(0, (now - last) / 1000));
    last = now;
    const w = 1000 / TAU_MS;
    const n = Math.max(1, Math.ceil(total * 120)), dt = total / n;
    for (let i = 0; i < n; i++) {
      const a = -w * w * (value - target) - 2 * w * vel;
      vel += a * dt;
      value += vel * dt;
    }
    if (Math.abs(value - target) * range() < 0.25 && Math.abs(vel) * range() < 20) {
      value = target; vel = 0; raf = 0; emit(); return;
    }
    emit();
    raf = requestAnimationFrame(step);
  }
  function set(t) {
    target = clampT(t);
    if (reduce) { value = target; vel = 0; emit(); return; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
  }
  function jump(t) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    stopFling();
    value = target = clampT(t); vel = 0; emit();
  }
  const unitsPerCss = () => getViewW() / Math.max(1, el.clientWidth);
  function panBy(dxUnits) { set(target + dxUnits / range()); }

  function onWheel(e) {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    stopFling();
    onInput();
    const k = e.deltaMode === 1 ? 40 : (e.deltaMode === 2 ? 800 : 1);
    panBy(d * k * unitsPerCss());
  }

  // ---- drag and fling ----
  let drag = null, fling = 0;
  function stopFling() { if (fling) { cancelAnimationFrame(fling); fling = 0; } }
  function onPointerDown(e) {
    if (e.button !== 0) return;
    stopFling();
    onInput();
    drag = { id: e.pointerId, x: e.clientX, t: performance.now(), v: 0 };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
    el.classList.add('is-dragging');
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now(), dx = e.clientX - drag.x, dt = Math.max(1, now - drag.t) / 1000;
    // a short running mean of the speed in CSS px/s
    drag.v = 0.7 * (dx / dt) + 0.3 * drag.v;
    drag.x = e.clientX; drag.t = now;
    if (dx) panBy(-dx * unitsPerCss());
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const v = performance.now() - drag.t < 80 ? drag.v : 0;
    drag = null;
    el.classList.remove('is-dragging');
    if (!reduce && Math.abs(v) > FLING.MIN) {
      let speed = -v * unitsPerCss(), t0 = performance.now();
      const run = (now) => {
        const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
        panBy(speed * dt);
        speed *= Math.exp(-dt / FLING.TAU);
        fling = Math.abs(speed) > 20 && target > 0 && target < 1 ? requestAnimationFrame(run) : 0;
      };
      fling = requestAnimationFrame(run);
    }
  }
  function onKey(e) {
    const vw = getViewW();
    const map = { ArrowLeft: -0.1 * vw, ArrowRight: 0.1 * vw, PageUp: -0.8 * vw, PageDown: 0.8 * vw };
    if (e.key in map) { e.preventDefault(); onInput(); panBy(map[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); onInput(); set(0); }
    else if (e.key === 'End') { e.preventDefault(); onInput(); set(1); }
  }

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('keydown', onKey);

  // The track is the whole strip: a press or a drag puts the view centre under the pointer.
  function attachTrack(tr) {
    let active = null;
    const toT = (clientX) => {
      const r = tr.getBoundingClientRect();
      const cx = (clientX - r.left) / Math.max(1, r.width) * contentW;
      return (cx - 0.5 * getViewW()) / range();
    };
    tr.addEventListener('pointerdown', (e) => {
      active = e.pointerId; stopFling(); onInput();
      try { tr.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
      set(toT(e.clientX));
    });
    tr.addEventListener('pointermove', (e) => { if (active === e.pointerId) set(toT(e.clientX)); });
    const end = (e) => { if (active === e.pointerId) active = null; };
    tr.addEventListener('pointerup', end);
    tr.addEventListener('pointercancel', end);
    tr.addEventListener('keydown', onKey);
  }

  return {
    set, jump, panBy, attachTrack,
    get: () => value * range(),
    getT: () => value,
    settled: () => !raf && !drag && !fling,
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      stopFling();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('keydown', onKey);
    },
  };
}
