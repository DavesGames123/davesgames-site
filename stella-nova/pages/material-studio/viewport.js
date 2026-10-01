// ============================================================================
//  MATERIAL STUDIO  ·  viewport.js — the 3D preview   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: VIEWPORT agent. Renders the baked maps on a mesh in canvas#vp with
//  GGX and split-sum IBL from env.js. Listens to bake:done, view:changed and
//  env:changed. The stub only clears the canvas, so the page shows its layout.
// ============================================================================
let gctx = null, gpuRef = null;

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  gpuRef = ctx.gpu;
  if (!ctx.gpu.ok) return;
  const canvas = ctx.$('vp');
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(r.height * devicePixelRatio));
  gctx = ctx.gpu.configureCanvas(canvas);
  const d = ctx.gpu.device, enc = d.createCommandEncoder();
  enc.beginRenderPass({ colorAttachments: [{ view: gctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.03, g: 0.035, b: 0.05, a: 1 } }] }).end();
  d.queue.submit([enc.finish()]);
}

/** Show a bake result. @param {import('./contract.js').MaterialMaps} maps @param {import('./contract.js').Scalars} scalars */
export function setMaps(maps, scalars) {}
/** @param {string} name one of contract MESHES */
export function setMesh(name) {}
/** @param {string} name one of contract DEBUG_VIEWS */
export function setDebugView(name) {}
