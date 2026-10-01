// ============================================================================
//  MATERIAL STUDIO  ·  viewport/render.js — the frame loop and the frame encoder
// ────────────────────────────────────────────────────────────────────────────
//  The viewport renders on demand. requestRender() asks for one frame, and
//  tick() keeps the loop alive only while the camera moves. renderScene()
//  encodes one frame: the shadow pass (only when its inputs change), the
//  main HDR pass, the tonemap pass and the FXAA pass. The canvas and
//  renderOffscreen() both use renderScene().
//
//  GREP TARGETS
//      requestRender .......... ask for one frame (coalesced into rAF)
//      tick ................... camera update, render, fps
//      renderToCanvas ......... targets for the canvas size, then renderScene
//      renderScene ............ shadow / main / post passes into outView
//      drawMesh ............... one material set, with the blend and cull rules
// ============================================================================
import * as C from '../contract.js';
import { device, state, canvas, gctx, cam, R, clamp } from './state.js';
import { ensureMesh, ensureEdges } from './preview-mesh.js';
import { envState, ensureFrameBG } from './environment.js';
import { lightsState } from './lights.js';
import { writeFrame, writeMaterial } from './uniforms.js';
import { pbrPipeline, shadowPipeline, bgPipeline, postPipeline } from './pipelines.js';
import { makeTargets, destroyTargets, aaMode } from './targets.js';
import { updateStats } from './hud.js';

/** Ask for one frame. Coalesces into the next animation frame. */
export function requestRender() {
  if (!device || R.disposed) return;
  R.needs = true;
  if (!R.raf) R.raf = requestAnimationFrame(tick);
}

function tick(t) {
  R.raf = 0;
  if (R.disposed) return;
  const dt = R.last ? (t - R.last) / 1000 : 1 / 60;
  R.last = t;
  const moving = cam.update(dt, canvas.width / Math.max(1, canvas.height));
  if (R.needs || moving) {
    R.needs = false;
    try { renderToCanvas(); } catch (e) { console.error('[viewport] render', e); }
    R.fpsN++;
    if (t - R.fpsT > 500) { R.fps = (R.fpsN * 1000) / (t - R.fpsT); R.fpsT = t; R.fpsN = 0; updateStats(); }
  }
  if (moving) R.raf = requestAnimationFrame(tick);
  else { R.last = 0; R.fpsN = 0; R.fpsT = t; }
}

function renderToCanvas() {
  if (!gctx) return;
  const { samples, fxaa } = aaMode();
  const w = canvas.width, h = canvas.height;
  const T0 = R.targets;
  if (!T0 || T0.w !== w || T0.h !== h || T0.samples !== samples || T0.fxaa !== fxaa) { destroyTargets(T0); R.targets = makeTargets(w, h, samples, fxaa); }
  const t0 = performance.now();
  renderScene(R.targets, gctx.getCurrentTexture().createView(), {});
  R.frameMs = performance.now() - t0;
  updateStats();
}

/**
 * Encode and submit one frame into `outView` (a view of T.finalFormat).
 * @param {object} T targets  @param {GPUTextureView} outView
 * @param {{set?:object, debug?:string, compare?:boolean}} o overrides
 */
export function renderScene(T, outView, o) {
  const mesh = ensureMesh();
  const e = envState();
  R.env = e;
  ensureFrameBG(e);
  const L = lightsState(e);
  R.key = L.key;
  const cur = o.set || R.cur;
  const compare = o.compare !== false && !o.set && state.view.compare !== 'off';
  const A = compare ? (R.A || (state.view.compare === 'prev' ? R.lastCopy : null)) : null;
  const fr = writeFrame(T, e, L, mesh, o);
  writeMaterial(cur);
  if (A) writeMaterial(A);

  const enc = device.createCommandEncoder({ label: 'vp-frame' });
  // shadow pass, only when its inputs changed
  const sig = `${R.meshKey}|${cur.version}|${L.key.map(x => x.toFixed(4))}|${state.view.displacement}|${state.view.uvScale}|${state.view.uvOffset}|${cur.scalars.displacementScale}|${cur.scalars.alphaMode}|${cur.scalars.alphaCutoff}|${e.key}`;
  if (state.view.shadows !== false && sig !== R.shadowSig) {
    const sp = enc.beginRenderPass({ label: 'vp-shadow', colorAttachments: [], depthStencilAttachment: { view: R.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    sp.setPipeline(shadowPipeline(e));
    sp.setBindGroup(0, R.shadowFrameBG); sp.setBindGroup(1, cur.bg);
    sp.setVertexBuffer(0, mesh.vbuf); sp.setIndexBuffer(mesh.ibuf, 'uint32');
    sp.drawIndexed(mesh.count);
    sp.end();
    R.shadowSig = sig;
  }

  const pass = enc.beginRenderPass({
    label: 'vp-main',
    colorAttachments: [{
      view: T.samples > 1 ? T.msaaView : T.hdrView, resolveTarget: T.samples > 1 ? T.hdrView : undefined,
      loadOp: 'clear', storeOp: T.samples > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1],
    }],
    depthStencilAttachment: { view: T.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
  });
  pass.setBindGroup(0, R.frameBG);
  pass.setPipeline(bgPipeline(e, T.samples, false)); pass.draw(3);
  if (fr.groundOn || state.view.grid) { pass.setPipeline(bgPipeline(e, T.samples, true)); pass.draw(6); }
  pass.setVertexBuffer(0, mesh.vbuf);
  const split = clamp(Math.round((+state.view.compareSplit || 0.5) * T.w), 0, T.w);
  const sides = A ? [[A, 0, split], [cur, split, T.w - split]] : [[cur, 0, T.w]];
  for (const [set, x, w] of sides) {
    if (w <= 0) continue;
    pass.setScissorRect(x, 0, w, T.h);
    drawMesh(pass, set, e, T.samples, mesh);
  }
  pass.setScissorRect(0, 0, T.w, T.h);
  if (state.view.wireframe) {
    ensureEdges(mesh);
    pass.setPipeline(pbrPipeline(e, T.samples, 'none', false, true));
    pass.setBindGroup(1, cur.bg);
    pass.setIndexBuffer(mesh.ebuf, 'uint32');
    pass.drawIndexed(mesh.ecount);
  }
  pass.end();

  // post
  const v = state.view;
  const tm = Math.max(0, C.TONEMAPPERS.indexOf(v.tonemap));
  device.queue.writeBuffer(R.postBuf, 0, new Float32Array([
    Math.pow(2, +v.exposure || 0), tm, fr.data ? 2 : fr.raw ? 1 : 0, fr.data ? 0 : 1,
    A ? split / T.w : -1, 0.75, 1 / T.w, 1 / T.h,
  ]));
  const post = (view, entry, bg) => {
    const p = enc.beginRenderPass({ label: 'vp-' + entry, colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    p.setPipeline(postPipeline(entry, T.finalFormat)); p.setBindGroup(0, bg); p.draw(3); p.end();
  };
  if (T.fxaa) { post(T.ldrView, 'fs_tonemap', T.tonemapBG); post(outView, 'fs_fxaa', T.fxaaBG); }
  else post(outView, 'fs_tonemap', T.tonemapBG);
  device.queue.submit([enc.finish()]);
}

function drawMesh(pass, set, e, samples, mesh) {
  const s = set.scalars;
  const blend = s.alphaMode === 'blend';
  const ds = !!s.doubleSided || mesh.name === 'plane' || mesh.name === 'custom';
  pass.setBindGroup(1, set.bg);
  pass.setIndexBuffer(mesh.ibuf, 'uint32');
  if (blend) {
    if (ds) { pass.setPipeline(pbrPipeline(e, samples, 'front', true)); pass.drawIndexed(mesh.count); }
    pass.setPipeline(pbrPipeline(e, samples, 'back', true)); pass.drawIndexed(mesh.count);
  } else {
    pass.setPipeline(pbrPipeline(e, samples, ds ? 'none' : 'back', false)); pass.drawIndexed(mesh.count);
  }
}
