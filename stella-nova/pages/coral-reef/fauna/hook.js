// ============================================================================
//  CORAL REEF  ·  fauna/hook.js  ·  the creatures on the page (main.js glue)
// ----------------------------------------------------------------------------
//  main.js calls only this file, in a few lines, so the page code of the
//  WORLD package and the FAUNA code stay apart:
//
//    const fauna = S ? mountFauna({ S, profile, onError }) : null;
//    fauna.start({ W, streamer, seed, profile, physics: () => P,
//                  squad: () => squad, origin: () => origin })  in buildWorld
//                  (profile: the world detail id; the creature budget)
//    fauna.stop()                                      in stopWorld
//    fauna.frame(dt, camera, eye)                      before S.render
//    fauna.saver(on)                                   the saver starts / ends
//    fauna.setEnabled(on), fauna.enabled               the "Creatures" toggle
//    fauna.feedTag(v) -> { name, sci, src } | null     the ROV HUD label of
//                       the creature that the feed camera of v looks at
//                       (rov/index.js createROVs option feedTag)
//    fauna.F                                           createFauna (or null)
//  Each render of S.scene (the main view, each ROV feed: rov/feed.js
//  drawScene) calls F.prepare(camera) from scene.onBeforeRender (after the
//  scene.js hook): the creature draw list of that camera. The chunks round
//  each ROV get animals within rovRing of the streamer budget.
//  The toggle state is kept in sessionStorage ('coral-reef-fauna').
//  A failure in the creatures turns them off with one console error; the
//  dive goes on.
//
//  grep -n targets: "export function mountFauna"
// ============================================================================
import { createFauna } from './index.js';
import { rovRing } from '../world/stream.js';

const KEY = 'coral-reef-fauna';
const store = (v) => { try { if (v === undefined) return sessionStorage.getItem(KEY); sessionStorage.setItem(KEY, v); } catch (e) { /* no storage */ } return null; };

export function mountFauna({ S, profile, onError = null }) {
  const THREE = S.THREE;
  const root = new THREE.Group(); root.name = 'fauna';
  S.scene.add(root);
  const prevBR = S.scene.onBeforeRender;
  S.scene.onBeforeRender = function (r, sc, cam, rt) {
    if (prevBR) prevBR.call(this, r, sc, cam, rt);
    if (F && enabled) { try { F.prepare(cam); } catch (e) { fail('view', e); } }
  };
  let F = null, ctx = null, enabled = store() !== '0', broken = false;
  const tags = new Map(), tp = new THREE.Vector3(), td = new THREE.Vector3();
  const fail = (where, e) => {
    console.error('coral-reef: fauna ' + where, e);
    broken = true;
    if (F) { try { F.dispose(); } catch (x) { /* already gone */ } F = null; }
    if (onError) onError(String((e && e.message) || e));
  };
  const rovs = () => {
    const sq = ctx && ctx.squad(); if (!sq) return null;
    return sq.vehicles.map(v => { const p = v.state.p, l = v.state.look, d = [l[0] - p[0], l[1] - p[1], l[2] - p[2]], n = Math.hypot(d[0], d[1], d[2]) || 1; return { p, look: [d[0] / n, d[1] / n, d[2] / n] }; });
  };
  function build() {
    if (!ctx || !enabled || broken || F) return;
    try {
      const HAS_WORKER = typeof Worker === 'function';
      F = createFauna({
        THREE, root, U: S.U, world: ctx.W, physics: ctx.physics(), profile: ctx.profile || profile, seed: ctx.seed,
        makeWorker: HAS_WORKER ? () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) : null,
        rovs, rovRing: ctx.streamer && ctx.streamer.budget ? rovRing(ctx.streamer.budget) : 0, onError: m => console.warn('coral-reef: fauna', m),
      });
      // the dwellers of the coral colonies (basket stars on the fans, crabs at the bases)
      if (ctx.streamer && ctx.streamer.on) {
        ctx.offs = [ctx.streamer.on('coral', (key, cols) => { if (F) F.addColonies(key, cols); }), ctx.streamer.on('uncoral', key => { if (F) F.removeColonies(key); })];
      }
    } catch (e) { fail('start', e); }
  }
  function teardown() {
    if (ctx && ctx.offs) for (const off of ctx.offs) { try { off(); } catch (e) { /* gone */ } }
    if (ctx) ctx.offs = null;
    if (F) { try { F.dispose(); } catch (e) { /* half built */ } F = null; }
    tags.clear();
  }
  return {
    start(c) { teardown(); ctx = Object.assign({ physics: () => null, squad: () => null, origin: () => [0, 0] }, c); build(); },
    stop() { teardown(); ctx = null; },
    frame(dt, camera, eye) {
      if (!F || !enabled) return;
      try { F.update(dt, camera, eye, ctx.origin()); } catch (e) { fail('frame', e); }
    },
    saver(on) {
      if (!F) return;
      // the saver films the squad: keep a few animals near the lead ROV
      F.setEscort(on ? () => { const sq = ctx && ctx.squad(); if (!sq) return null; const st = sq.vehicles[0].state; return [st.look[0], st.look[1], st.look[2]]; } : null);
    },
    setEnabled(on) {
      enabled = !!on; store(enabled ? '1' : '0');
      if (enabled) build(); else teardown();
      root.visible = enabled;
    },
    get enabled() { return enabled; },
    get F() { return F; },
    feedTag(v) {
      if (!F || !enabled || !v || !v.camera) return null;
      const now = performance.now(), c = tags.get(v.id);
      if (c && now - c.t < 300) return c.tag;
      v.camera.getWorldPosition(tp); v.camera.getWorldDirection(td);
      const o = ctx.origin();
      const hit = F.lookAt([tp.x + o[0], tp.y, tp.z + o[1]], [td.x, td.y, td.z], 12);
      const tag = hit ? { name: hit.name, sci: hit.sci, src: hit.src } : null;
      tags.set(v.id, { t: now, tag });
      return tag;
    },
    dispose() { teardown(); S.scene.remove(root); S.scene.onBeforeRender = prevBR; },
  };
}
