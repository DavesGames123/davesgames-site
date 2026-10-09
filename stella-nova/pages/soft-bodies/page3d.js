// ============================================================================
//  PAGE 3D  ·  pages/soft-bodies/page3d.js — the sim kit page controller
//  shared by the three.js Ten Minute Physics ports
// ----------------------------------------------------------------------------
//  boot(spec) mounts the sim kit GUI (widgets/sim-kit/ui.js) over the
//  upstream demo, hands the frame loop to stage3d.install, and defines the
//  screensaver through the kit director (widgets/sim-kit/saver.js).
//  Used by soft-bodies, soft-body-interaction, soft-body-skinning, cloth
//  and cloth-self-collision. Each page gives a spec (its sim.js):
//    G               live getters for the upstream globals (THREE,
//                    gThreeScene, gRenderer, gCamera, gCameraControl,
//                    gGrabber, gPhysicsScene)
//    title, sub, panelTitle, footer
//    schema(phone), guard(next)    controls and the stability guard
//    build(state, rng)             a new scene (bodies, obstacles)
//    live(state, out)              a change that needs no rebuild
//    look(state)                   materials after a theme or style change
//    simulate()                    one upstream frame step
//    focus() -> [x,y,z]            the subject, for the camera
//    size() -> scale               the subject spread (saver radii)
//    actions, shots, tick(dt, ctx), fov
//  Flow: a key with rebuild: true builds a new scene; a look key repaints;
//  any other key is a live set. "New scene", a group dice, the hash and
//  the saver all go through build().
//
//  grep -n targets: "export function boot", "function rebuild",
//  "director({"
// ============================================================================
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { director } from '../../widgets/sim-kit/saver.js';
import * as S3 from './stage3d.js';

export function boot(spec) {
  const G = spec.G, PHONE = isPhone();
  const SCHEMA = spec.schema(PHONE);
  const REBUILD = new Set(), LOOK = new Set(['theme', 'palette', 'mat', 'shadows', 'grid', 'fog']);
  for (const g of SCHEMA.groups) for (const c of g.controls) { if (c.rebuild) REBUILD.add(c.key); if (g.id === 'look' && c.key) LOOK.add(c.key); }
  const rig = new S3.Rig();
  let D = null, loop = null;

  const kit = mount({
    schema: SCHEMA, title: spec.title, sub: spec.sub, panelTitle: spec.panelTitle || 'Scene', footer: spec.footer,
    guard: spec.guard, themeKey: 'theme', actions: spec.actions || {},
  });
  const P = { kit, G, rig, PHONE, get saver() { return D; }, rebuild, look };

  function rebuild() {
    const r = K.rng((kit.seed ^ 0x2545f491) >>> 0);
    spec.build(kit.state, r, P);
    look();
    spec.live && spec.live(kit.state, {}, P);
    if (loop) loop.retarget = true;
  }
  function look() { S3.themeScene(G, kit.state); spec.look && spec.look(kit.state, P); }

  kit.on('change', (out, st, why) => {
    if (why === 'scene' || why === 'group' || why === 'saver' || why === 'saver-exit') return;
    const keys = Object.keys(out || {});
    if (keys.some(k => REBUILD.has(k))) { rebuild(); return; }
    if (keys.some(k => LOOK.has(k))) look();
    spec.live && spec.live(st, out, P);
  });
  kit.on('scene', () => rebuild());
  kit.on('reset', () => rebuild());

  loop = S3.install(G, {
    kit, rig, fov: spec.fov,
    simulate: () => spec.simulate(P),
    focus: () => spec.focus(P),
    saver: () => D,
    before: spec.before ? dt => spec.before(dt, P) : null,
    after: spec.after ? (dt, n) => spec.after(dt, n, P) : null,
  });
  P.loop = loop;

  if (!kit.fromHash) kit.newScene(); else rebuild();
  // start from the page's own camera framing
  if (spec.home) spec.home(P);

  D = director({
    kit, canvas: () => G.gRenderer.domElement, guard: spec.guard,
    shots: spec.shots.map(s => Object.assign({ params: st => spec.params ? spec.params(st, P) : [] }, s)),
    apply(state, shot, cam) {
      rebuild();
      if (shot && shot.start) try { shot.start(P, cam); } catch (e) { console.error(e); }
      rig.set(cam, spec.focus(P), spec.size ? spec.size(P) : 1);
    },
    frame(band) { loop.setBand(band); },
    tick(dt, ctx) { if (spec.tick) spec.tick(dt, ctx, P); },
    exit() { loop.setBand(null); rig.set(null); loop.retarget = true; if (spec.home) spec.home(P); },
  });

  addEventListener('pagehide', () => { kit.playing = false; });
  window['__' + (spec.id || 'page3d')] = P;
  return P;
}
