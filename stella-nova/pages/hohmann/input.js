/* ═════════════════════════════════════════════════════════════
   INPUT
   ═════════════════════════════════════════════════════════════ */
// Hover: pick the nearest planet within 22 px and show its orbital data.
cvs.addEventListener('mousemove',e=>{
  const rc=cvs.getBoundingClientRect();
  const mx=e.clientX-rc.left, my=e.clientY-rc.top;
  // Find the closest planet under the cursor within the pick radius.
  hovered=null; let md=22;
  planets.forEach(p=>{
    const pos=pPos(p);
    const d=Math.hypot(pos.x-mx,pos.y-my);
    if(d<md){md=d;hovered=p}
  });
  const hb=document.getElementById('hoverbox');
  if(hovered){
    hb.innerHTML=`<strong style="color:${hovered.color}">${hovered.name}</strong>  r=${hovered.r.toFixed(3)} AU  ·  v=${(hovered.speed*AU2KMS).toFixed(2)} km/s  ·  T=${hovered.period.toFixed(2)} yr`;
    cvs.style.cursor='pointer';
  } else {
    hb.textContent='hover over a planet';
    cvs.style.cursor='crosshair';
  }
});
// Leaving the canvas clears the hover state and resets the hover box.
cvs.addEventListener('mouseleave',()=>{hovered=null;document.getElementById('hoverbox').textContent='hover over a planet';});

// Click a planet to select it. Behaviour differs between hop mode (park, then
// pick destinations) and normal mode (pick source, then target).
cvs.addEventListener('click',()=>{
  if(!hovered) return;
  if(hopMode){
    // First hop click: park a stationary ship on the chosen home planet.
    if(!source){
      source=hovered; hopHomePlanet=hovered;
      const pos=pPos(hovered);
      // launchT is set one unit in the past so the ship reads as already arrived.
      ship={
        x:pos.x, y:pos.y, launchAng:pos.ang, periAng:pos.ang,
        launchT:simTime-1, trail:[], arrived:true,
        arriveAng:pos.ang, arriveT:simTime,
        arriveOmega:hovered.omega, r2:hovered.r
      };
      setStatus(`PARKED AT ${hovered.name.toUpperCase()} — SELECT DESTINATION`);
      renderMath();
    // Second hop click: choose a destination and compute its transfer.
    } else if(hovered!==source&&!target&&ship&&ship.arrived){
      target=hovered;
      xfer=computeXfer(source.r,target.r);
      launchWindows=computeWindows(source,target,xfer,simTime);
      setStatus(`${source.name.toUpperCase()} → ${target.name.toUpperCase()} — PRESS ▶ LAUNCH`);
      setBtnLaunch(true);
      setEqPanelActive(true);
      renderMath();
    }
    return;
  }
  // Normal mode, first click: set the source orbit.
  if(!source){
    source=hovered;
    setStatus(`SOURCE: ${source.name.toUpperCase()} — SELECT TARGET`);
    renderMath();
  // Normal mode, second click: set the target and compute the transfer.
  } else if(hovered!==source&&!target){
    target=hovered;
    xfer=computeXfer(source.r,target.r);
    launchWindows=computeWindows(source,target,xfer,simTime);
    setStatus('TRANSFER COMPUTED — PRESS ▶ LAUNCH');
    setBtnLaunch(true);
    setEqPanelActive(true);
    renderMath();
  }
});

// Touch support — tap = click on nearest planet
// Set hovered from the touch point (wider 28 px radius), then synthesise a click.
cvs.addEventListener('touchstart',e=>{
  if(e.touches.length!==1) return;
  e.preventDefault();
  const rc=cvs.getBoundingClientRect();
  const t=e.touches[0];
  const mx=t.clientX-rc.left, my=t.clientY-rc.top;
  hovered=null; let md=28;
  planets.forEach(p=>{
    const pos=pPos(p);
    const d=Math.hypot(pos.x-mx,pos.y-my);
    if(d<md){md=d;hovered=p}
  });
  if(hovered) cvs.dispatchEvent(new MouseEvent('click'));
},{passive:false});

// Keyboard shortcuts: Space pauses, C clears the selection, Enter launches.
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT') return;
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  else if(e.key==='c'||e.key==='C'){ clearSel(); }
  else if(e.key==='Enter'){ if(!document.getElementById('btnLaunch').disabled) launch(); }
});

// Toggle the paused flag and update the sim-status badge.
function togglePause(){
  paused=!paused;
  const el=document.getElementById('simStatus');
  el.textContent=paused?'Paused':'Sim Active';
  el.className='sys-status'+(paused?' paused':'');
}

// Fire the transfer now. Grade the timing against the nearest ideal window,
// then create the ship at the source's current angle and start it coasting.
function launch(){
  if(!source||!target||!xfer) return;
  // Launch from wherever the source planet is right now.
  const pos=pPos(source);
  const actualAng=pos.ang;
  // Grade how far this instant is from the perfect phasing.
  const dtYears=nearestWindowDt(source,target,xfer,simTime);
  launchScore=scorelaunch(dtYears);
  // periAng orients the ellipse so periapsis lies along the departure radius.
  ship={launchAng:actualAng, periAng:xfer.asc?actualAng:actualAng+Math.PI,
        launchT:simTime, trail:[], arrived:false, x:0, y:0, r2:xfer.r2};
  launchWindows=[];
  setTbar(true,'⚡ TRANSFER IN PROGRESS — SPACECRAFT EN ROUTE');
  setStatus('TRANSFERRING'); setBtnLaunch(false);
}

// Toggle hop mode on or off. Either way, reset all selection and ship state and
// update the button and status to the mode's starting prompt.
function toggleHopMode(){
  hopMode=!hopMode;
  const btn=document.getElementById('btnHop');
  if(hopMode){
    hopLog=[]; hopHomePlanet=null;
    btn.classList.add('active');
    btn.innerHTML='&#11041; Hopping';
    source=target=xfer=ship=null; launchWindows=[]; launchScore=null;
    setBtnLaunch(false); setTbar(false);
    setEqPanelActive(false);
    setStatus('HOP MODE — SELECT HOME PLANET');
    renderMath();
  } else {
    btn.classList.remove('active');
    btn.innerHTML='&#11041; Hop';
    hopLog=[]; hopHomePlanet=null;
    source=target=xfer=ship=null; launchWindows=[]; launchScore=null;
    setBtnLaunch(false); setTbar(false);
    setEqPanelActive(false);
    setStatus('AWAITING SELECTION');
    renderMath();
  }
}

// Clear the current selection and ship without leaving the current mode.
function clearSel(){
  source=target=xfer=ship=null; launchWindows=[]; launchScore=null;
  if(hopMode){ hopLog=[]; hopHomePlanet=null; setStatus('HOP MODE — SELECT HOME PLANET'); }
  else setStatus('AWAITING SELECTION');
  setBtnLaunch(false); setTbar(false);
  setEqPanelActive(false);
  renderMath();
}

// Speed slider: reflect the chosen multiplier in the readout label.
document.getElementById('spSlider').addEventListener('input',function(){
  const v=parseFloat(this.value);
  document.getElementById('spVal').textContent=(v<1?v.toFixed(2):v%1===0?v:v.toFixed(1))+'\u00d7';
});

// Mobile drawer
// Open or close the slide-in math panel and its backdrop on narrow screens.
function toggleMathDrawer(){
  const p=document.getElementById('mathpanel');
  const f=document.getElementById('fabMath');
  const b=document.getElementById('drawerBackdrop');
  const open=!p.classList.contains('open');
  p.classList.toggle('open',open);
  f.classList.toggle('open',open);
  b.classList.toggle('show',open);
}
// Force the math drawer closed (used on preset load at narrow widths).
function closeMathDrawer(){
  document.getElementById('mathpanel').classList.remove('open');
  document.getElementById('fabMath').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('show');
}

