// ============================================================================
//  MAGNETLAB  ·  2D magnetic field simulator  (canvas 2D)
// ----------------------------------------------------------------------------
//  Every magnet is a rigid body carrying a set of point dipoles ("poles"). The
//  field at any point is the vector sum of each pole's dipole field. Massless
//  tracer particles ride that field like iron filings, and dynamic magnets feel
//  the force and torque the field exerts on their own poles. All of it draws to
//  one canvas through a pan/zoom camera transform.
//
//  FIELD MODEL   (one pole, in the pole's local frame)
//  --------------------------------------------------------------------------
//      B(r) = FIELD_SCALE * ( 3(m·r̂)r̂ − m ) / r³        point dipole
//
//         S ●━━━▶━━━ N        m points S→N; field loops N back to S
//          ╲   ╱ ╲   ╱
//           ╲ ╱   ╲ ╱         tracers follow B̂, biased to spawn near tips
//            ●     ●
//
//  SIMULATION LOOP   (loop(), 60 Hz via requestAnimationFrame)
//  --------------------------------------------------------------------------
//      integrateMagnets()   spin, then force+torque, then collisions
//      refreshFrameCache()  poles, magnet boxes, spawn tips, view box
//      updateTracers(dt)    step each tracer along B̂, respawn when dead
//      render()             clear ▶ camera ▶ grid ▶ layers ▶ magnets
//  The loop stops while the page is hidden (visibilitychange).
//
//  TRACER DRAW
//      Trails live in typed ring buffers. renderTracersGL() draws all trails
//      in one instanced WebGL call on a hidden canvas, with a smooth fade and
//      color along each trail. render() adds that canvas with 'lighter'.
//      renderTracers2D() is the bucket fallback when WebGL is not available.
//
//  COORDINATE FRAMES
//      screen px ── screenToWorld() ──▶ world px ── camera transform ──▶ canvas
//      CW / CH   = logical CSS-pixel size of the canvas (physics units)
//      CAM.x/y   = world offset from centre;  CAM.zoom = scale factor
//
//  FILE MAP   (main/<part>.js, in load order; each part lists its grep targets)
//  --------------------------------------------------------------------------
//      state .......... canvas, ctx, CW/CH, SIM, magnets, CAM, screenToWorld
//      magnets ........ createMagnet: pole layout per type
//      field .......... dipoleField, pole cache, fieldAt, fieldFromOthers
//      physics ........ integrateMagnets: spin, force, torque, collisions
//      tracers ........ trail rings, tracerBudget, spawn, updateTracers
//      colors ......... FIELD_RAMP_STOPS: field magnitude → RGB ramp
//      render ......... render, renderHeatmap, renderArrows
//      tracer-shaders . TR_VS / TR_FS, glslRamp, uMode colour modes
//      tracer-gl ...... glCanvas, initTracerGL, renderTracersGL, renderTracers
//      tracer-2d ...... renderTracers2D: bucket fallback without WebGL
//      glyphs ......... renderMagnets and one drawer per magnet type
//      ui ............. panel and card controls (onclick globals)
//      input .......... drag, pan, wheel zoom, pinch
//      resize ......... resize + ResizeObserver
//      loop ........... loop, visibilitychange, started
//      saver-scenes ... saver state, VIEWS, SAVER_SCENES
//      saver-plate .... SV_PLATE, svAnchor, saverPlate
//      saver-filings .. seedFilings, renderFilings
//      saver .......... saverScene, saverStep, saverOverlay, window.snSaver
//      boot ........... INIT: the 50 ms start (last)
//
//  LOADER   (this file)
//      index.html loads main.js as a classic script. main.js appends one
//      <script async=false> per part, so the parts run in order. They are
//      classic scripts too, so they share one global scope: a let or const
//      of one part is visible in the next, and index.html can call the
//      ui functions from onclick. Function hoisting does not cross files,
//      so top-level code in a part uses only what earlier parts declare.
//      tests.mjs runs the same parts in the same order in a node vm.
//
//      grep -n targets: "const PARTS", "s.async"
// ============================================================================

(function(){
  const PARTS=['state','magnets','field','physics','tracers','colors','render',
    'tracer-shaders','tracer-gl','tracer-2d','glyphs','ui','input','resize','loop',
    'saver-scenes','saver-plate','saver-filings','saver','boot'];
  const base=document.currentScript.src;
  for(const p of PARTS){
    const s=document.createElement('script');
    s.src=new URL('main/'+p+'.js',base).href; s.async=false;
    document.body.appendChild(s);
  }
})();
