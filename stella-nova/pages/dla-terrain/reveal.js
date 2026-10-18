// ============================================================================
//  DLA TERRAIN  ·  reveal.js — the calm loading view and the fade-in (ATMO)
// ----------------------------------------------------------------------------
//  WHY (2026-10-18, the user): "dla doesn't need to show everything as it
//  loads". Before, the canvas showed the world as it was made: the terrain
//  snapshots, the LODs, the ground sets, the plants and the clouds came in
//  one by one. Now, on the first load and on each Generate, a veil (a sky
//  gradient, the stage label and a thin bar) covers the canvas. The page
//  goes on drawing under it, so the GPU uploads, the plant scatter, the sky
//  LUTs and the cloud and froxel histories settle. When the world is ready,
//  WARM_FRAMES more frames are drawn, then the canvas fades in over FADE_S.
//
//  READY  the terrain is done (the worker sent "done"), every module is
//  loaded and its textures are in (main.js loading.done), and the plant
//  stream has no pending tiles (vegetation stats().streamPending 0). Caps:
//  MODULE_WAIT_S after the terrain for the modules and textures, VEG_WAIT_S
//  for the plants, so a slow network never keeps the veil for ever.
//
//  NOT VEILED  "Watch it build" (the player shows the stages: the user
//  asked for it) and the screensaver (it has its own plates).
//
//  DOM-free core: revealBegin / revealTick (tests/reveal.test.mjs). The DOM
//  part (createReveal) sets canvas.style.opacity and makes the veil element
//  next to the canvas (inline styles; pointer-events none, so the input
//  under it still works).
//
//  grep -n targets: "export const REVEAL", "export function revealBegin",
//  "export function revealTick", "export function createReveal"
// ============================================================================

export const REVEAL = Object.freeze({
  WARM_FRAMES: 24,     // drawn frames between ready and the fade (histories settle)
  FADE_S: 0.6,         // the fade-in
  MODULE_WAIT_S: 10,   // the most wait for modules and textures after the terrain
  VEG_WAIT_S: 4,       // the most wait for the plant stream after the rest
});

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };

// st.phase: 'shown' | 'loading' | 'warm' | 'fade'; st.opacity of the canvas
export function revealState() {
  return { phase: 'shown', opacity: 1, warm: 0, t: 0, waitT: 0, vegT: 0, why: '' };
}
// a new world. o = { build: Watch it build on, saver: the screensaver runs }
export function revealBegin(st, o = {}) {
  if (o.build || o.saver) { st.phase = 'shown'; st.opacity = 1; st.why = o.build ? 'build' : 'saver'; return st; }
  st.phase = 'loading'; st.opacity = 0; st.warm = 0; st.t = 0; st.waitT = 0; st.vegT = 0; st.why = 'terrain';
  return st;
}
// one frame. inp = { dt s, terrainDone, modulesDone, vegPending, drawn }
export function revealTick(st, inp) {
  const dt = clamp(Number.isFinite(inp.dt) ? inp.dt : 1 / 60, 0, 0.1);
  if (st.phase === 'loading') {
    if (!inp.terrainDone) { st.why = 'terrain'; return st; }
    st.waitT += dt;
    const modsOk = !!inp.modulesDone || st.waitT > REVEAL.MODULE_WAIT_S;
    if (!modsOk) { st.why = 'modules'; return st; }
    const vegOk = !(inp.vegPending > 0) || (st.vegT += dt) > REVEAL.VEG_WAIT_S;
    if (!vegOk) { st.why = 'plants'; return st; }
    st.phase = 'warm'; st.warm = 0; st.why = 'warm';
  }
  if (st.phase === 'warm') {
    if (inp.drawn) st.warm++;
    if (st.warm >= REVEAL.WARM_FRAMES) { st.phase = 'fade'; st.t = 0; st.why = 'fade'; }
    return st;
  }
  if (st.phase === 'fade') {
    st.t += dt;
    st.opacity = smooth(st.t / REVEAL.FADE_S);
    if (st.t >= REVEAL.FADE_S) { st.phase = 'shown'; st.opacity = 1; st.why = ''; }
  }
  return st;
}

// the DOM part: o = { canvas, doc }
export function createReveal(o = {}) {
  const st = revealState();
  const canvas = o.canvas || null, doc = o.doc || null;
  let veil = null, text = null, bar = null, shownOp = -1;
  function makeVeil() {
    if (veil || !doc || !canvas || !canvas.parentNode) return;
    veil = doc.createElement('div');
    veil.id = 'revealVeil';
    veil.setAttribute('aria-live', 'polite');
    veil.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;'
      + 'background:linear-gradient(180deg,#1d3557 0%,#46668c 45%,#9fb4c8 78%,#cdbfa6 100%);color:rgba(255,255,255,0.86);'
      + 'font:500 13px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0.04em;transition:none';
    text = doc.createElement('div');
    text.textContent = 'Shaping the land';
    const track = doc.createElement('div');
    track.style.cssText = 'width:min(220px,60vw);height:2px;border-radius:1px;background:rgba(255,255,255,0.22);overflow:hidden';
    bar = doc.createElement('div');
    bar.style.cssText = 'height:100%;width:0%;background:rgba(255,255,255,0.8);transition:width 0.4s ease';
    track.appendChild(bar);
    veil.appendChild(text); veil.appendChild(track);
    canvas.parentNode.insertBefore(veil, canvas.nextSibling);
  }
  function apply() {
    if (canvas && canvas.style && st.opacity !== shownOp) {
      canvas.style.opacity = st.opacity >= 1 ? '' : st.opacity.toFixed(3);
      shownOp = st.opacity;
    }
    if (st.phase !== 'shown') makeVeil();
    if (veil) {
      veil.style.opacity = (1 - st.opacity).toFixed(3);
      veil.style.display = st.phase === 'shown' ? 'none' : 'flex';
    }
  }
  const api = {
    state: st,
    get hiding() { return st.phase === 'loading' || st.phase === 'warm'; },
    get veil() { return veil; },
    begin(opts) { revealBegin(st, opts); apply(); },
    // the stage label and the share 0..1 of the generation (calm text)
    label(s, frac) {
      if (text && s) text.textContent = s;
      if (bar && Number.isFinite(frac)) bar.style.width = (100 * clamp(frac, 0, 1)).toFixed(0) + '%';
    },
    tick(inp) {
      const before = st.phase;
      revealTick(st, inp);
      if (before !== st.phase && text) {
        if (st.phase === 'warm' || st.phase === 'fade') { text.textContent = 'Settling the sky'; if (bar) bar.style.width = '100%'; }
      }
      apply();
      return st;
    },
    // show at once (the saver enters, Watch it build turns on)
    show() { st.phase = 'shown'; st.opacity = 1; apply(); },
  };
  return api;
}
