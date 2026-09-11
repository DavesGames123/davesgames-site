/* ═══════════ MAIN LOOP ═══════════ */
// Frame timers: last frame time, FPS accumulators, and per-task interval clocks.
let last=0,fc=0,ft=0,anTick=0,tunTick=0,domTick=0;
// The requestAnimationFrame driver. It reads the spectrum once, then runs each
// task on its own cadence so the expensive detection does not run every frame.
function loop(t){
  requestAnimationFrame(loop);
  // Delta time, clamped so a background tab does not produce a huge step.
  const dt=Math.min((t-last)/1000,0.1);last=t;
  // FPS counter, updated twice a second.
  fc++;ft+=dt;if(ft>=0.5){$('st-fps').textContent=Math.round(fc/ft)+' fps';fc=0;ft=0;}
  if(micOn){
    // One spectrum read per frame feeds both the spectrogram and detection.
    analyser.getFloatFrequencyData(freqData);
    drawSpec();
    // Chord detection at ~16 Hz; update the match-confidence readout.
    anTick+=dt;
    if(anTick>0.06){anTick=0;analyzeFrame();
      if(curChord&&curChord.score)$('chordConf').textContent=Math.round(curChord.score*100)+' % match';}
    // Tuner at ~11 Hz.
    tunTick+=dt;
    if(tunTick>0.09){tunTick=0;updateTuner();}
    // Dominant-chord banner at 4 Hz.
    domTick+=dt;
    if(domTick>0.25){domTick=0;renderDominant();}
    $('st-level').innerHTML='level <b>'+(level*100|0)+'</b>';
    $('st-tune').innerHTML='tuning <b>'+(tuningCents>0?'+':'')+tuningCents.toFixed(0)+'¢</b>';
  }
  // Always animate the ring and meter; repaint diagram/staff only when dirty.
  drawRing();
  drawMeter();
  if(diagDirty){diagDirty=false;redrawDiagram();}
  if(staffDirty)drawStaff();
}
// Repaint the diagram and staff canvases when their boxes resize.
if(window.ResizeObserver){
  new ResizeObserver(()=>{diagDirty=true;staffDirty=true;}).observe($('diagCanvas'));
  new ResizeObserver(()=>{staffDirty=true;}).observe($('staffScroll'));
}else window.addEventListener('resize',()=>{diagDirty=true;staffDirty=true;});

/* ═══════════ MOBILE TABS ═══════════ */
// On narrow screens only one column shows at a time. Set the body class that CSS
// keys off, highlight the active tab, and flag canvases to redraw on reveal.
const mobTabs=$('mobTabs');
function setMTab(t){
  document.body.className=document.body.className.replace(/\bmtab-\w+/g,'').trim();
  document.body.classList.add('mtab-'+t);
  [...mobTabs.children].forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  diagDirty=true;staffDirty=true;   // canvases were 0×0 while hidden — redraw on reveal
}
mobTabs.addEventListener('click',e=>{
  const b=e.target.closest('button');if(b)setMTab(b.dataset.t);
});
setMTab('now');

// Start on a friendly default chord and kick off the render loop.
setDiagramChord(0,'');   // C major as the friendly default
buildVoicingBtns();
requestAnimationFrame(loop);
