/* ═══════════ MAIN LOOP ═══════════ */
// GREP: loop | renderHero | renderHistory | syncMicUi | setMTab | keydown
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
      if(curChord&&curChord.score&&!chordHeld){
        const pct=Math.max(0,Math.min(100,Math.round(curChord.score*100)));
        $('chordConf').textContent=pct+' % match';
        $('confBar').style.width=pct+'%';
      }}
    // Tuner at ~11 Hz.
    tunTick+=dt;
    if(tunTick>0.09){tunTick=0;updateTuner();}
    // Dominant-chord banner at 4 Hz.
    domTick+=dt;
    if(domTick>0.25){domTick=0;renderDominant();}
    $('st-level').innerHTML='level <b>'+(level*100|0)+'</b>';
    $('st-tune').innerHTML='tuning <b>'+(tuningCents>0?'+':'')+tuningCents.toFixed(0)+'¢</b>';
  }
  // Always animate the ring, meter and tuner needle; repaint the hero, the
  // history chips, the diagram and the staff only when their input changed.
  drawRing();
  drawMeter();
  drawGauge(dt);
  renderHero();
  renderHistory();
  syncMicUi();
  if(diagDirty){diagDirty=false;redrawDiagram();}
  if(staffDirty)drawStaff();
}
// Repaint the diagram and staff canvases when their boxes resize.
if(window.ResizeObserver){
  new ResizeObserver(()=>{diagDirty=true;staffDirty=true;}).observe($('diagCanvas'));
  new ResizeObserver(()=>{staffDirty=true;}).observe($('staffScroll'));
}else window.addEventListener('resize',()=>{diagDirty=true;staffDirty=true;});

/* ═══════════ HERO + HISTORY ═══════════ */
// The hero under the ring: the chord's notes, each with its interval name,
// in the root's hue for the root. Repaints only when the chord changes.
let heroKey=null,heroHeld=null;
function renderHero(){
  const k=curChord?curChord.root+'|'+curChord.q:'';
  if(k===heroKey&&chordHeld===heroHeld)return;
  heroHeld=chordHeld;
  $('heroMeta').classList.toggle('held',!!(curChord&&chordHeld));
  if(k===heroKey)return;
  heroKey=k;
  const el=$('chordNotes');
  if(!curChord){
    el.innerHTML='<span class="nEmpty">Notes show here</span>';
    $('confBar').style.width='0%';
    return;
  }
  const r=curChord.root;
  const iv=curChord.q==='·note'?[0]:(QUALS[curChord.q]||QUALS['']).iv;
  el.innerHTML=iv.map(i=>{
    const pc=(r+i)%12;
    return `<span class="nchip${i===0?' root':''}" style="--c:${pcColor(pc,i===0?70:82)}"><b>${NOTE_NAMES[pc]}</b><small>${curChord.q==='·note'?'note':DEG_NAMES[i]}</small></span>`;
  }).join('');
}
// Recent chords as chips, newest on the right and scrolled into view.
let histSig='';
function renderHistory(){
  const sig=chordLog.length+'|'+lastLogT;
  if(sig===histSig)return;
  histSig=sig;
  const el=$('histList');
  if(!chordLog.length){el.innerHTML='<span class="hEmpty">Chords you play line up here.</span>';return;}
  const from=Math.max(0,chordLog.length-24);
  el.innerHTML=chordLog.slice(from).map((e,i,a)=>
    `<span class="hchip${i===a.length-1?' new':''}" style="--c:${pcColor(e.root,72)}">${NOTE_NAMES[e.root]}<small>${e.q}</small></span>`).join('');
  el.scrollLeft=el.scrollWidth;
}

/* ═══════════ MIC STATES ═══════════ */
// The gate is a full start card before the first start. After a pause it
// comes back as a small resume card that leaves the held chord in view.
// "Look around first" closes the card; #micGo in the Listen header then
// starts the mic. The pill names the state: off, asking, live or paused.
let everStarted=false,gateSkipped=false,micUiSig='';
function syncMicUi(){
  if(micOn)everStarted=true;
  const gate=$('micGate');
  const st=micOn?'live':micBusy?'asking':everStarted?'paused':'off';
  const sig=st+'|'+gateSkipped+'|'+gate.classList.contains('hidden');
  if(sig===micUiSig)return;
  micUiSig=sig;
  gate.classList.toggle('busy',micBusy);
  gate.classList.toggle('resume',everStarted);
  if(gateSkipped&&!micOn&&!micBusy)gate.classList.add('hidden');
  $('gateSkip').textContent=everStarted?'Hide':'Look around first';
  const pill=$('micPill');
  pill.textContent={live:'Listening',asking:'Asking…',paused:'Paused',off:'Mic off'}[st];
  pill.className='pill '+st;
  $('micGo').hidden=micOn||micBusy||!gate.classList.contains('hidden');
  $('micGo').textContent=everStarted?'Resume':'Start listening';
}
$('gateSkip').addEventListener('click',()=>{gateSkipped=true;$('micGate').classList.add('hidden');micUiSig='';});
$('micGo').addEventListener('click',()=>{gateSkipped=false;startMic();});
$('micBtn').addEventListener('click',()=>{gateSkipped=false;});

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

/* ═══════════ KEYBOARD ═══════════ */
// Keys for hands that are busy with an instrument. Keys are ignored while
// typing, and with Cmd, Ctrl or Alt held, so browser shortcuts still work.
//   Space start / pause   H hear the chord   ← → voicing   1-5 instrument
//   C copy the chord log   [ ] reference pitch A4   ? the key card
function toggleKeys(on){
  const k=$('keysCard');
  k.hidden=on===undefined?!k.hidden:!on;
}
$('st-keys').addEventListener('click',()=>toggleKeys());
$('keysCard').addEventListener('click',()=>toggleKeys(false));
function typing(t){return t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable);}
addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||typing(e.target))return;
  const k=e.key;
  if(k===' '){
    // Space on a focused button would also press that button; take it here.
    e.preventDefault();
    if(!e.repeat){if(micOn)stopMic();else{gateSkipped=false;startMic();}}
  }else if(k==='h'||k==='H')strum();
  else if(k==='ArrowLeft'||k==='ArrowRight'){
    if(instrument!=='guitar'&&instrument!=='ukulele')return;
    const n=voicingsFor(diagChord.root,diagChord.q).length;
    if(n<2)return;
    e.preventDefault();
    voicingIdx=(voicingIdx+(k==='ArrowRight'?1:n-1))%n;
    diagDirty=true;buildVoicingBtns();
  }else if(k>='1'&&k<='5'){
    const b=$('instSeg').children[+k-1];if(b)b.click();
  }else if(k==='c'||k==='C')copyLog();
  else if(k==='['||k===']')setA4(A4+(k===']'?1:-1));
  else if(k==='?')toggleKeys();
  else if(k==='Escape')toggleKeys(false);
});
// A Space keyup on a focused button would click it; the keydown handled it.
addEventListener('keyup',e=>{if(e.key===' '&&!typing(e.target))e.preventDefault();});

// Start on a friendly default chord and kick off the render loop.
setDiagramChord(0,'');   // C major as the friendly default
buildVoicingBtns();
requestAnimationFrame(loop);
