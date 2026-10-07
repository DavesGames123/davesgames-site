// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  renders.js — the black-hole scene
// ----------------------------------------------------------------------------
//  A scene is plain state plus step(dt) and uniforms(w, h). mountScene()
//  puts it on a page canvas and draws a new frame only when the view
//  changes (a drag, a slider, a toggle or a resize), so the page figure
//  stands still until the reader moves it. saver.js draws the same scene
//  on its own canvas with a slow orbit.
//
//  EXPORTS   (jump with grep -n "<anchor>" renders.js)
//    black hole .... "export function holeScene"
//    mount ......... "export function mountScene"
// ============================================================================
import { HOLE } from './glsl.js';
import { makeGL, runLoop, dragOrbit } from './glkit.js';

const orbitPos = (tgt, d, yaw, pitch) => [tgt[0] + d * Math.cos(pitch) * Math.sin(yaw), tgt[1] + d * Math.sin(pitch), tgt[2] + d * Math.cos(pitch) * Math.cos(yaw)];

// Units G = c = M = 1 (r_s = 2). The disk runs from the innermost stable
// orbit (r = 6) to r = 15. t stays 0 on the page: the disk does not churn.
export function holeScene() {
  return {
    frag: HOLE, name: 'hole',
    t: 0, yaw: 0.3, pitch: 0.16, dist: 38, zoom: 1.3, held: false, spin: 0, off: [0, 0],
    disk: 1, shift: 1, lens: 1, rin: 6, rout: 15,
    step(dt) { this.t += dt * this.spin; if (!this.held) this.yaw += dt * this.spin * 0.6; },
    key() { return [this.yaw, this.pitch, this.dist, this.disk, this.shift, this.lens, this.t].map(v => v.toFixed(4)).join(','); },
    uniforms() {
      return {
        uTime: this.t, uOff: this.off, uCamPos: orbitPos([0, 0, 0], this.dist, this.yaw, this.pitch), uCamTgt: [0, 0, 0], uZoom: this.zoom,
        uDiskOn: this.disk, uShiftOn: this.shift, uLensOn: this.lens, uRin: this.rin, uRout: this.rout,
      };
    },
  };
}

// Put a scene on a canvas. Returns null with no WebGL 2 (the caller shows
// the fallback). It draws only when scene.key() or the size changes.
export function mountScene(canvas, scene, { maxDpr = 1.5, pitch = [0.02, 1.3] } = {}) {
  let G;
  try { G = makeGL(canvas); } catch (e) { G = null; }
  if (!G) return null;
  let prog;
  try { prog = G.program(scene.name, scene.frag); }
  catch (e) { console.error(e); return null; }
  dragOrbit(canvas, scene, { pitchMin: pitch[0], pitchMax: pitch[1] });
  let last = '';
  const loop = runLoop(canvas, (dt, t, w, h) => {
    if (G.lost()) return;
    scene.step(dt);
    const k = scene.key() + '|' + w + 'x' + h;
    if (k === last) return;
    last = k;
    G.draw(prog, scene.uniforms(w, h), w, h);
  }, { maxDpr, budgetMs: 40 });
  loop.scale = 1;
  return { G, loop, scene };
}
