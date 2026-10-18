// ============================================================================
//  CORAL REEF  ·  the reef worker (module worker): growth AND meshing
// ----------------------------------------------------------------------------
//  Runs reef.js (the shared DLA growth) and coral-sdf.js (the coral SDF
//  meshes, fine and coarse LOD) off the main thread. Each tick grows for
//  growMs, gives the new particles to the mesher, meshes for meshMs, and
//  posts the new particles, the changed bricks and the progress. The page
//  keeps a mirror of the particles (reef.js createReefMirror) for the
//  colour modes and the data textures.
//
//  Messages in (from the page):
//    { type: 'init', seed, quality, radius, detail, rockSeed, rockQuality,
//      sites?, preset?, colonies?, env?, rate?, play? }
//        build the rock SDF (rock/index.js createRock, no rock mesh when
//        sites are given: the page samples them from its own rock), then
//        the reef and its colony seeds. rockSeed, radius, detail and
//        rockQuality must be those of the page's rock (the SDF detail
//        depends on the quality; default 'high'). rate: polyps per second (default
//        Infinity: as fast as the budget allows).
//    { type: 'single', site, species, size?, cap?, rate?, seed? }
//        single-colony mode (the saver): one colony from a seed. The
//        first 'single' parks the main reef (its particles, colonies and
//        growth state; its mesher is dropped) and grows the colony in a
//        second reef on the same rock. A later 'single' starts that
//        second reef again.
//    { type: 'restore', seed?, preset?, colonies?, sites? }
//        the saver exit. With a parked main reef: it comes back as it
//        was (no regrowth): gen + 1, the colonies, ALL its particles
//        with their old births (so the page shows no grow-in), then a
//        new mesher that gets every particle at once and meshes them in
//        the ticks (about 1 s to feed and 3 s to mesh 48 k particles in
//        node). A colony at its cap stays full; a colony that still grew
//        goes on. With no parked reef: the same as 'reset'.
//        Cost note: a full regrow (R.growAll) of the main reef takes
//        24 s (phone) to 42 s (mid) in node, so the worker parks it.
//    { type: 'reset', seed?, preset?, colonies?, sites? }   new colonies, same rock
//        (a parked main reef is dropped)
//    { type: 'play', on }            grow or pause (meshing goes on)
//    { type: 'rate', value }         polyps per second (Infinity = max)
//    { type: 'env', env }            speed, nutrient, temp, strength
//    { type: 'current', deg, strength }
//    { type: 'params', id, p }       dlaf parameters of a species (metres)
//    { type: 'plant', id, site }     one more colony at a rock site
//    { type: 'view', points, budget? }   view points (camera, ROVs): the
//        nearest colonies get the fine mesh, in the fine triangle budget,
//        with hysteresis (reef.js holdFocus): a focus colony keeps its
//        fine mesh while the view stays within 1.5 x its entry distance
//        (+ 3 m), and for 8 s at least
//    { type: 'focus', ks }           the fine-mesh colonies, by hand
//    { type: 'budget', growMs, meshMs, maxPost }
//  Messages out:
//    { type: 'ready', gen, rockMs, quality, budget }
//    { type: 'colonies', gen, list: [colonyInfo + count] }
//    { type: 'particles', gen, from, data }   PARTICLE_FLOATS per particle
//    { type: 'bricks', gen, list: [{ sp, lod, k, field, key, chunk, cell,
//        positions, normals, gids, indices, polyps, tris }] }   (typed arrays
//        transferred; k: the colony of a fine brick, -1 for a coarse one)
//    { type: 'fine', gen, list: [{ k, state: 'complete' | 'drop' }] }
//        after the bricks of the same tick. complete: the fine mesh of
//        colony k is all out (show it, then hide the coarse mesh of k).
//        drop: the fine field of k is gone (show the coarse mesh of k,
//        then remove its fine group; no brick removals come for it)
//    { type: 'progress', gen, count, target, fraction, done, live, fusions,
//        overgrowths, tris, trisFine, trisCoarse, polyps, focus, dirty,
//        growMs, meshMs, rate }
//    { type: 'idle', gen }            grown and meshed: nothing to do
//    { type: 'error', message }
//  gen counts the resets, so the page drops results of an old reef.
//
//  grep -n targets
//    the runner ........... "export function createReefRunner"
//    one tick ............. "function tick"
//    focus from view ...... "function viewFocus"
//    fine-field events .... "function postEvents"
// ============================================================================
import { createReef, packParticles, colonyInfo, holdFocus, QUALITY } from './reef.js';
import { createCoralMesher } from './coral-sdf.js';

// post(msg, transfer) sends a message. makeRock(opts) -> rock (tests give
// a stub; the worker imports rock/index.js on demand). timers { set, clear }
// and clock() -> ms: tests drive the ticks with a fake clock.
export function createReefRunner({ post, makeRock, timers, clock: clockFn } = {}) {
  const T = timers || { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) };
  const clock = clockFn || (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  let rock = null, R = null, M = null, gen = 0, timer = 0, playing = true;
  let growMs = 9, meshMs = 9, maxPost = 4000, sent = 0, fed = 0, idleSent = false;
  let lastT = 0, progAt = 0, viewPts = null, viewBudget = 0, viewAt = 0, cfg = {};
  // held: the focus colonies with their entry time and distance (holdFocus)
  let held = new Map();
  // parked: the main reef while the saver grows its colony (single), or null
  let parked = null, reefOpts = null;
  const T0 = clock();

  function newMesher() {
    M = createCoralMesher({ fine: R.fine, radius: R.radius, polyps: R.Q.polyps, lod: cfg.lod !== false });
    sent = 0; fed = 0; held = new Map();
  }
  function sendColonies() {
    post({ type: 'colonies', gen, list: R.colonies.map(c => Object.assign(colonyInfo(c), { count: c.count })) });
    for (const c of R.colonies) if (!M.cols.has(c.k)) M.addColony(colonyInfo(c));
  }

  async function init(m) {
    cfg = m;
    const t0 = clock();
    const ro = { seed: m.rockSeed ?? m.seed ?? 1, radius: m.radius ?? 30, detail: m.detail ?? 1, quality: m.rockQuality || 'high', mesh: !m.sites };
    rock = makeRock ? await makeRock(ro) : (await import('./rock/index.js')).createRock(ro);
    const rockMs = clock() - t0;
    reefOpts = { rock, seed: m.seed ?? 1, quality: m.quality, radius: ro.radius, rate: m.rate ?? Infinity, budget: m.budget };
    R = createReef(Object.assign({ env: m.env }, reefOpts));
    parked = null;
    gen++;
    newMesher();
    R.populate({ preset: m.preset, colonies: m.colonies, sites: m.sites });
    post({ type: 'ready', gen, rockMs, quality: R.quality, budget: R.Q });
    sendColonies();
    viewFocus(true);
    schedule();
  }

  function single(m) {
    if (!R) return;
    // the first single parks the main reef; the saver colony grows in a
    // reef of its own (same rock, same water)
    if (!parked && !R.single) {
      parked = { R };
      R = createReef(Object.assign({}, reefOpts, { env: Object.assign({}, parked.R.env, { cur: parked.R.env.cur.slice() }) }));
    }
    gen++;
    if (m.rate !== undefined) R.setRate(m.rate);
    R.growColony(m.site, m.species, { size: m.size, cap: m.cap, seed: m.seed });
    newMesher();
    sendColonies();
    M.setFocus(R.colonies.map(c => c.k));          // the saver colony is always fine
    schedule();
  }

  function reset(m) {
    if (!R) return;
    if (parked) { R = parked.R; parked = null; }
    gen++;
    R.populate({ preset: m.preset ?? cfg.preset, colonies: m.colonies ?? cfg.colonies, sites: m.sites ?? cfg.sites, seed: m.seed });
    newMesher();
    sendColonies();
    viewFocus(true);
    schedule();
  }

  // The saver exit: the parked main reef comes back as it was. All its
  // particles go to the page at once (old births: no grow-in), and a new
  // mesher gets all of them now, so each brick meshes about once.
  function restore(m) {
    if (!R) return;
    if (!parked) { reset(m); return; }
    R = parked.R; parked = null;
    gen++;
    newMesher();
    sendColonies();
    for (let from = 0; from < R.count; from += maxPost) {
      const to = Math.min(R.count, from + maxPost), data = packParticles(R, from, to);
      post({ type: 'particles', gen, from, data }, [data.buffer]);
    }
    sent = R.count;
    for (let g = 0; g < R.count; g++) M.add(g, R.parent[g], R.px[g], R.py[g], R.pz[g], R.col[g]);
    fed = R.count;
    viewFocus(true);
    idleSent = false;
    schedule();
  }

  // The nearest colonies to the view points get the fine mesh, while the
  // estimated fine triangles stay in the budget (default 0.7 x Q.tris; the
  // coarse mesh of all colonies takes the rest). holdFocus keeps a focus
  // colony while the view stays near it (hysteresis, a hold time), so the
  // focus does not churn while the camera moves (no fine mesh is made
  // again for a colony that stays in the focus).
  function viewFocus(force) {
    if (!R || !M || !M.lod || !viewPts || R.single) return;
    const t = clock();
    if (!force && t - viewAt < 500) return;
    viewAt = t;
    const ks = holdFocus(R.colonies, viewPts, viewBudget || R.Q.tris * 0.7, held, t);
    M.setFocus(ks);
  }
  // fine-field events after the bricks: 'complete' (the page shows the
  // fine mesh and hides the coarse one), 'drop' (the coarse one shows)
  function postEvents() {
    const ev = M.takeEvents();
    if (ev.length) post({ type: 'fine', gen, list: ev });
  }

  function tick() {
    timer = 0;
    if (!R) return;
    const t = clock(), dt = lastT ? Math.min(250, t - lastT) : 16;
    lastT = t;
    let grew = 0;
    const g0 = clock();
    if (playing && !R.done()) grew = R.step(dt, growMs, t - T0);
    const gms = clock() - g0;
    // new particles: to the page, then to the mesher (in the mesh budget)
    if (R.count > sent) {
      const to = Math.min(R.count, sent + maxPost);
      const data = packParticles(R, sent, to);
      post({ type: 'particles', gen, from: sent, data }, [data.buffer]);
      if (to > sent && R.colonies.length > M.cols.size) sendColonies();
      sent = to;
    }
    const m0 = clock();
    while (fed < sent && clock() - m0 < meshMs * 0.5) {
      const end = Math.min(sent, fed + 64);
      for (let g = fed; g < end; g++) M.add(g, R.parent[g], R.px[g], R.py[g], R.pz[g], R.col[g]);
      fed = end;
    }
    viewFocus(false);
    const left = Math.max(1, meshMs - (clock() - m0));
    const out = M.update(left);
    if (out.length) {
      const tr = [];
      for (const r of out) tr.push(r.positions.buffer, r.normals.buffer, r.gids.buffer, r.indices.buffer, r.polyps.buffer);
      post({ type: 'bricks', gen, list: out }, tr);
    }
    postEvents();
    const mms = clock() - m0;
    const busy = (playing && !R.done()) || fed < R.count || sent < R.count || M.dirty() > 0;
    if (t - progAt > 250 || !busy) {
      progAt = t;
      const st = M.stats();
      post(Object.assign({ type: 'progress', gen }, R.progress(), {
        tris: st.tris, trisFine: st.trisFine, trisCoarse: st.trisCoarse, polyps: st.polyps, focus: st.focus, dirty: st.dirty,
        growMs: gms, meshMs: mms, grew, rate: R.rate,
      }));
    }
    if (busy) { idleSent = false; schedule(); }
    else if (!idleSent) { idleSent = true; post({ type: 'idle', gen }); }
  }
  function schedule() { if (!timer) timer = T.set(tick, 0) || 1; }

  async function onMessage(m) {
    try {
      switch (m.type) {
        case 'init': await init(m); break;
        case 'single': single(m); break;
        case 'reset': reset(m); break;
        case 'restore': restore(m); break;
        case 'play': playing = !!m.on; schedule(); break;
        case 'rate': if (R) R.setRate(m.value); schedule(); break;
        case 'env': if (R) Object.assign(R.env, m.env || {}); schedule(); break;
        case 'current': if (R) R.setCurrent(m.deg, m.strength); break;
        case 'params': if (R) R.setParams(m.id, m.p); break;
        case 'plant': if (R && R.addColony(m.id, m.site, { size: m.size, cap: m.cap })) { sendColonies(); schedule(); } break;
        case 'view': viewPts = m.points; viewBudget = m.budget || 0; viewFocus(true); schedule(); break;
        case 'focus': if (M) { M.setFocus(m.ks || []); schedule(); } break;
        case 'budget': growMs = m.growMs ?? growMs; meshMs = m.meshMs ?? meshMs; maxPost = m.maxPost ?? maxPost; break;
        default: break;
      }
    } catch (e) {
      post({ type: 'error', message: String(e && e.stack || e) });
    }
  }
  return { onMessage, get reef() { return R; }, get mesher() { return M; }, get gen() { return gen; }, get parked() { return parked ? parked.R : null; }, QUALITY };
}

// In a worker: wire the runner to self. (Node tests set self.__reefTest
// and drive createReefRunner themselves.)
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function' && !self.__reefTest) {
  const run = createReefRunner({ post: (m, tr) => self.postMessage(m, tr || []) });
  self.onmessage = e => run.onMessage(e.data);
}
