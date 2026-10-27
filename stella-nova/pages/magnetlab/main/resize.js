// ============================================================================
//  MAGNETLAB  ·  canvas sizing  (part 14 of 20)
// ----------------------------------------------------------------------------
//  resize() matches the canvas and the WebGL tracer canvas to the wrapper
//  at the device pixel ratio. A ResizeObserver calls it.
//
//  grep -n targets: "function resize", "ResizeObserver"
// ============================================================================

/* ═══ RESIZE — uses ResizeObserver on the wrapper div ═══ */
// Match the canvas backing store to the wrapper size times the device pixel
// ratio (capped at 2), and set the transform so drawing stays in CSS pixels.
function resize(){
  const wrap=document.getElementById('canvas-wrap');
  CW=wrap.clientWidth;
  CH=wrap.clientHeight;
  if(CW<10||CH<10){CW=300;CH=300;} // fallback
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=CW*dpr;
  canvas.height=CH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  // The WebGL tracer canvas uses the same backing size.
  glCanvas.width=canvas.width; glCanvas.height=canvas.height;
  document.getElementById('st-dims').textContent=CW+'×'+CH;
}

// Prefer ResizeObserver so the canvas tracks the wrapper through layout changes,
// not just window resizes; fall back to the resize event where it is absent.
// Use ResizeObserver for reliable sizing
if(window.ResizeObserver){
  new ResizeObserver(()=>{resize();spawnTracers();}).observe(document.getElementById('canvas-wrap'));
} else {
  window.addEventListener('resize',()=>{resize();spawnTracers();});
}
