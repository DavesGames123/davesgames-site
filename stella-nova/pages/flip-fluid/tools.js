// ============================================================================
//  FLIP WATER  ·  tools.js  —  the objects palette and the pointer tools
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  Pointer rules (main.js calls app.tools.down / move / up first):
//    - press on a body: grab it. A spring pulls the grabbed point to the
//      pointer (bodies.js couple, b.grab), so the body swings, and on
//      release it keeps its speed: a flick throws it.
//    - press on the water with a kind armed in the palette: drop one of
//      that kind there (it stays armed; tap the kind again to disarm).
//    - press with the eraser on: delete the body under the pointer.
//    - else: stir (main.js).
//  The palette (sheet section "Objects") has one button per kind with an
//  icon from art.js, "Drop 3 random", "Clear objects" and the eraser.
//  Keys: O drops a random object at the top, X toggles the eraser,
//  Delete clears all objects.
//
//  Bodies added here are not in the URL hash: the hash keeps the scene's
//  own objects (the "objects" category of the randomizer).
//
//  grep -n targets
//    function pick        body under a point
//    function dropAt      spawn one body
//    export function installTools
// ============================================================================
import { KINDS, KIND_IDS, spawn } from './bodies.js';
import { sdfWorld } from './shapes.js';
import { drawIcon } from './art.js';

function pick(sim, p, pad) {
  let best = null, bd = pad;
  for (const b of sim.solids) {
    if (b.kinematic || !b.active) continue;
    const d = sdfWorld(b, p.x, p.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function installTools(app, $) {
  const T = { armed: null, erase: false, grabbed: null, rnd: Math.random };

  function dropAt(kind, x, y, extra = {}) {
    const sim = app.sim, K = KINDS[kind];
    const o = Object.assign({ kind, x, y, a: (T.rnd() - 0.5) * 0.8, size: 0.85 + 0.4 * T.rnd(), density: +(K.density * (0.9 + 0.2 * T.rnd())).toFixed(3), colour: Math.floor(T.rnd() * 6), look: 1 + Math.floor(T.rnd() * 1e6) }, extra);
    const b = spawn(sim, app.spec, o);
    // keep it inside the tank
    const m = b.shape.bound + 2 * sim.h;
    b.x = Math.min(app.spec.W - m, Math.max(m, b.x)); b.y = Math.min(app.spec.H - m, Math.max(m, b.y));
    return b;
  }
  function dropRandom(n = 1) {
    for (let k = 0; k < n; k++) {
      const kind = KIND_IDS[Math.floor(T.rnd() * KIND_IDS.length)];
      dropAt(kind, (0.15 + 0.7 * T.rnd()) * app.spec.W, (0.8 + 0.12 * T.rnd()) * app.spec.H);
    }
  }
  function clearObjects() {
    for (const b of app.sim.solids.slice()) if (!b.kinematic) app.sim.removeSolid(b);
    T.grabbed = null;
  }

  app.tools = {
    down(p) {
      const sim = app.sim;
      if (T.erase) { const b = pick(sim, p, 3 * sim.h); if (b) sim.removeSolid(b); return true; }
      const b = pick(sim, p, 1.5 * sim.h);
      if (b) {
        const c = Math.cos(b.a), s = Math.sin(b.a), dx = p.x - b.x, dy = p.y - b.y;
        b.grab = { x: p.x, y: p.y, lx: c * dx + s * dy, ly: -s * dx + c * dy };
        T.grabbed = b; app.canvas.classList.add('grab');
        return true;
      }
      if (T.armed) { dropAt(T.armed, p.x, p.y); return true; }
      return false;
    },
    move(p) {
      if (T.grabbed && T.grabbed.grab) { T.grabbed.grab.x = p.x; T.grabbed.grab.y = p.y; return true; }
      return !!(T.erase || T.armed);
    },
    up() {
      if (T.grabbed) { T.grabbed.grab = null; T.grabbed = null; app.canvas.classList.remove('grab'); }
    },
  };

  // ---- palette UI ----
  const host = $('palette');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function markArmed() {
    for (const btn of host.querySelectorAll('button[data-kind]')) {
      const on = btn.dataset.kind === T.armed;
      btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    $('bErase').classList.toggle('on', T.erase); $('bErase').setAttribute('aria-pressed', T.erase ? 'true' : 'false');
    $('toolHint').textContent = T.erase ? 'Eraser on: tap an object to delete it.'
      : T.armed ? `Tap the water to drop a ${KINDS[T.armed].name.toLowerCase()}. Tap it again to stop.`
      : 'Pick an object, then tap the water to drop it. Drag any object to move or throw it.';
  }
  for (const kind of KIND_IDS) {
    const btn = document.createElement('button');
    btn.className = 'kind'; btn.dataset.kind = kind; btn.title = `${KINDS[kind].name} (density ${KINDS[kind].density})`;
    btn.setAttribute('aria-label', KINDS[kind].name); btn.setAttribute('aria-pressed', 'false');
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(34 * dpr);
    btn.appendChild(cv);
    const lab = document.createElement('span'); lab.textContent = KINDS[kind].name; btn.appendChild(lab);
    try { drawIcon(cv.getContext('2d'), kind, cv.width); } catch (e) { /* icon only */ }
    btn.onclick = () => {
      T.armed = T.armed === kind ? null : kind; T.erase = false; markArmed();
      // on a phone the sheet covers the tank: close it so the user can tap
      if (T.armed && matchMedia('(max-width: 768px)').matches && app.openPanel) app.openPanel(false);
    };
    host.appendChild(btn);
  }
  $('bDrop3').onclick = () => dropRandom(3);
  $('bClearObj').onclick = clearObjects;
  $('bErase').onclick = () => { T.erase = !T.erase; if (T.erase) T.armed = null; markArmed(); };
  markArmed();

  app.onKey = ((prev) => (k, e) => {
    if (k === 'o') dropRandom(1);
    else if (k === 'x') { T.erase = !T.erase; if (T.erase) T.armed = null; markArmed(); }
    else if (k === 'delete' || k === 'backspace') clearObjects();
    else if (prev) prev(k, e);
  })(app.onKey);

  app.objects = { dropAt, dropRandom, clearObjects, state: T };
  return T;
}
