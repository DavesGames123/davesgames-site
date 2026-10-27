// ============================================================================
//  MAGNETLAB  ·  init  (part 20 of 20, last)
// ----------------------------------------------------------------------------
//  Paints the panel sliders, then starts the page after 50 ms: size,
//  streamer budget, magnet list, one bar magnet, the loop. This part is
//  last, so every function and binding that boot and loop() use exists.
//
//  grep -n targets: "INIT", "setTimeout"
// ============================================================================

/* ═══ INIT ═══ */
// Paint the fixed panel sliders once, then start after a short delay so the
// wrapper has a measured size. Init sizes the canvas, spawns tracers, builds
// the list, drops one bar magnet, and kicks off the loop.
document.querySelectorAll('#panel input[type=range]').forEach(sg);
// Delay init slightly to ensure layout is computed
setTimeout(()=>{
  resize();
  // Set the default streamer count from the canvas size (see tracerBudget).
  const sl=document.getElementById('sl-tracer-count');
  sl.value=tracerBudget(); updateTracerCount(sl);
  rebuildMagnetList();
  addMagnet('bar');
  started=true; lastTime=performance.now();
  if(!document.hidden) rafId=requestAnimationFrame(loop);
},50);
