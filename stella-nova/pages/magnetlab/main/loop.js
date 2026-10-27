// ============================================================================
//  MAGNETLAB  ·  frame driver  (part 15 of 20)
// ----------------------------------------------------------------------------
//  loop() runs one frame: saver step, physics, pole cache, tracers, status
//  readouts, render. The loop stops while the page is hidden. started is
//  here so the hidden-page handler and snSaver.enter() can read it before
//  boot.js runs.
//
//  grep -n targets: "function loop", "visibilitychange", "let started"
// ============================================================================

/* ═══ LOOP ═══ */
// Frame driver: measure dt (clamped so a stalled tab cannot jump the physics),
// step the simulation when playing, refresh the status readouts, and render.
// The pole cache refreshes after the magnets move and before any field use.
let lastTime=0,fpsCounter=0,fpsTime=0,rafId=0;
const stFps=document.getElementById('st-fps'), stField=document.getElementById('st-field'), stZoom=document.getElementById('st-zoom');
function loop(time){
  rafId=requestAnimationFrame(loop);
  const dt=Math.max(0,Math.min((time-lastTime)/1000,0.05));lastTime=time;
  fpsCounter++;fpsTime+=dt;
  if(fpsTime>=0.5){stFps.textContent=Math.round(fpsCounter/fpsTime)+' fps';fpsCounter=0;fpsTime=0;}
  if(saverOn) saverStep(dt);
  if(SIM.playing) integrateMagnets();
  refreshFrameCache();
  if(SIM.playing) updateTracers(dt);
  if(magnets.length>0){
    fieldAt(CW/2,CH/2);
    stField.textContent='B: '+Math.sqrt(FBx*FBx+FBy*FBy).toExponential(1);
  }
  stZoom.textContent=CAM.zoom.toFixed(1)+'×';
  render();
  if(saverOn) saverOverlay();
}

// Stop the loop while the page is hidden. The browser already stops rAF in a
// hidden tab. This also makes sure that no step runs on return with a long dt.
// On return, reset lastTime so the first dt is near zero.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ if(rafId){cancelAnimationFrame(rafId);rafId=0;} }
  else if(!rafId && started){ lastTime=performance.now(); rafId=requestAnimationFrame(loop); }
});

let started=false;
