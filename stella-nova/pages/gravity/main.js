// ============================================================================
//  GRAVITY PLAYGROUND  ·  2D N-body gravity sandbox
// ----------------------------------------------------------------------------
//  A classic (non-module) script that integrates Newtonian gravity for a small
//  set of point masses and draws them on a 2D canvas. Every body pulls on every
//  other body (O(N^2) pairwise sum); state advances by velocity-Verlet, a
//  symplectic scheme that keeps total energy flat instead of drifting. Presets,
//  display toggles, and readouts are plain DOM elements this file wires by id.
//
//  COORDINATE FRAME   (world space; camera maps world to screen)
//  ---------------------------------------------------------------------------
//      world (0,0) sits at the system centre; +x right, +y down.
//          screen = canvasCentre + cam + world · camZoom     worldToScreen()
//          world  = (screen − canvasCentre − cam) / camZoom   screenToWorld()
//
//  FORCE + INTEGRATION LOOP   (one step, velocity-Verlet / kick-drift-kick)
//  ---------------------------------------------------------------------------
//      computeForces()   Fᵢ = Σⱼ G·mᵢ·mⱼ·(rⱼ−rᵢ) / (|r|²+ε)     ε softening = 4
//                           │           aᵢ = Fᵢ / mᵢ
//                           ▼
//      step(h)  ┌─ half kick    v += ½·a·h
//               ├─ drift        x += v·h
//               ├─ recompute    computeForces()   (new a at new x)
//               └─ half kick    v += ½·a·h
//                           │
//                           ▼
//               trails, wound angle, simTime advance
//
//  FRAME   (loop, requestAnimationFrame)
//  ---------------------------------------------------------------------------
//      loop() ─┬─ substep step(h) × round(timeScale)   keeps each h small
//              ├─ render()         bodies, vectors, trails, field, grid
//              └─ every 3rd frame  calcEnergy() ▶ readouts + energy graph
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ---------------------------------------------------------------------------
//      state ............. "SIMULATION STATE"       globals: G, dt, camera, bodies
//      body factory ...... "function makeBody"      one point-mass record
//      presets ........... "/* PRESETS */"          5 named initial conditions
//      load / clear ...... "function loadPreset"    swap the whole body set
//      forces ............ "function computeForces" pairwise gravity, softened
//      integrator ........ "function step"          velocity-Verlet advance
//      energy ............ "function calcEnergy"    KE, PE, momentum for the HUD
//      canvas + input .... "CANVAS + INPUT"         canvas setup, mouse, touch
//      transforms ........ "function worldToScreen" world and screen mapping
//      rendering ......... "/* RENDERING */"        the whole scene draw
//      arrows ............ "function drawArrow"     vector glyph, clamped length
//      energy graph ...... "function renderEnergyGraph" KE/PE/total trace
//      resonance ......... "function renderResonance"   angular-position dial
//      UI ................ "/* UI */"               toggles, body list, drawers
//      selected body ..... "function updateSelPanel"    per-body readout
//      keys .............. "addEventListener('keydown'" keyboard shortcuts
//      frame loop ........ "function loop"          per-frame update
//      boot .............. "function init"          first preset, start loop
// ============================================================================

/* SIMULATION STATE */
// Physics constants and integrator step. G is tunable; dt is the base step,
// timeScale multiplies it, simTime accumulates simulated seconds.
var G=1000,dt=0.01,timeScale=1.0,simTime=0;
// Run state and display toggles. Each show* flag maps to one Display switch.
var paused=false,vecScale=1.0,trailLen=400;
var showForce=true,showVel=true,showAcc=false,showTrails=true,showField=false,showLines=false,showGrid=true;
// The body set and the index of the inspected body (−1 = none selected).
var bodies=[],selectedIdx=-1;
// Camera: pan offset in pixels and a zoom factor applied to world coordinates.
var camX=0,camY=0,camZoom=1;
// Pan gesture bookkeeping: start pointer and start camera, captured on down.
var isPan=false,panSX=0,panSY=0,panCX=0,panCY=0;
// Launch-drag bookkeeping: start and current pointer while dragging a new body.
var isDrag=false,dragSX=0,dragSY=0,dragCX=0,dragCY=0;
// A drag shorter than this (pixels) counts as a click, not a launch.
var DRAG_THRESHOLD=8;
// Canvas handles: main scene, energy graph, resonance dial, and their contexts.
var canvas,ctx,energyCanvas,energyCtx,resCanvas,resCtx;
// Rolling energy trace for the graph, capped at maxEnergyPts samples.
var energyHistory=[],maxEnergyPts=200;
// Palette cycled through as new bodies are spawned.
var bodyColors=['#ffc832','#5cd8e8','#e87466','#7ad87a','#d870c8','#e89858','#96c8ff','#e0e060','#60e0a0','#e060e0'];
// nextId hands each body a stable id; currentPreset drives the reset key.
var nextId=0,currentPreset='laplace';

// One body record. Stores position, velocity, and the force/accel scratch
// fields the integrator fills each step, plus a trail and a wound-angle counter.
function makeBody(name,x,y,vx,vy,mass,radius,color,fixed){
  return{id:nextId++,name:name,x:x,y:y,vx:vx,vy:vy,ax:0,ay:0,fx:0,fy:0,mass:mass,radius:radius,color:color,fixed:fixed||false,trail:[],angle:0,lastAngle:null};
}

/* PRESETS */
// Each preset builds a fresh `bodies` array of initial conditions. Circular
// speeds come from v = sqrt(G·M/r), the balance of gravity and centripetal need.
// A 1:2:4 Laplace resonance: three moons whose periods lock in a 1:2:4 ratio.
function laplace(){
  // Galilean 1:2:4 resonance. Star mass dominates so mutual moon-moon
  // perturbations stay small; orbits stay cleanly Keplerian for many periods.
  var star=8000;
  var r1=110;
  // Kepler III (T² ∝ r³) inverted: a period ratio k needs radius r1·k^(2/3).
  var r2=r1*Math.pow(2,2/3);    // ~174.6, T2/T1 = 2
  var r3=r1*Math.pow(4,2/3);    // ~277.2, T3/T1 = 4
  var v1=Math.sqrt(G*star/r1);
  var v2=Math.sqrt(G*star/r2);
  var v3=Math.sqrt(G*star/r3);
  bodies=[
    makeBody('Star',0,0,0,0,star,20,'#ffeebb',true),
    makeBody('Io',r1,0,0,v1,1.5,5,'#ffc832'),
    makeBody('Europa',0,r2,-v2,0,2,6,'#5cd8e8'),
    makeBody('Ganymede',-r3,0,0,-v3,3,8,'#e87466'),
  ];
}
// Two equal stars orbiting their shared centre, plus a light planet outside.
// Each star orbits at radius sep from the midpoint, so its orbital radius about
// the barycentre is 2·sep and its speed is sqrt(G·m/(4·sep)).
function binaryStar(){
  var sep=100,m=2000,v=Math.sqrt(G*m/(4*sep));
  bodies=[
    makeBody('Alpha',sep,0,0,v,m,14,'#ffc832'),
    makeBody('Beta',-sep,0,0,-v,m,14,'#5cd8e8'),
    makeBody('Planet',0,300,-Math.sqrt(G*2*m/300)*0.95,0,5,5,'#7ad87a'),
  ];
}
// The figure-eight choreography: three equal masses chase each other along one
// shared figure-eight curve. The exact starting positions and velocities are the
// known periodic solution; s and vs only rescale it to canvas units.
function figure8(){
  // Chenciner-Montgomery (1993)
  var s=100,m=500;
  var vs=Math.sqrt(G*m/s);
  bodies=[
    makeBody('A',-0.97000436*s, 0.24308753*s,  0.466203685*vs,  0.43236573*vs,m,10,'#ffc832'),
    makeBody('B', 0.97000436*s,-0.24308753*s,  0.466203685*vs,  0.43236573*vs,m,10,'#5cd8e8'),
    makeBody('C', 0,             0,           -0.93240737*vs, -0.86473146*vs,m,10,'#e87466'),
  ];
}
// A fixed sun with five planets on near-circular orbits at random phase angles.
// Each planet gets the circular speed for its radius, aimed perpendicular to the
// radius vector so the orbit starts tangent.
function miniSolar(){
  var star=8000;
  bodies=[makeBody('Sun',0,0,0,0,star,22,'#ffe080',true)];
  var radii=[80,130,190,280,400];
  var names=['Mercury','Venus','Earth','Mars','Jupiter'];
  var cols=['#c8a060','#e0c880','#5090e0','#e05030','#e0a050'];
  var masses=[3,8,10,5,80],sizes=[4,6,7,5,12];
  for(var i=0;i<5;i++){
    var r=radii[i],v=Math.sqrt(G*star/r);
    var ang=Math.random()*Math.PI*2;
    bodies.push(makeBody(names[i],r*Math.cos(ang),r*Math.sin(ang),-v*Math.sin(ang),v*Math.cos(ang),masses[i],sizes[i],cols[i]));
  }
}
// Five comparable masses seeded on a ring with jittered radius and speed. No
// dominant central mass, so the system is chaotic and diverges within a few orbits.
function chaos5(){
  bodies=[];
  for(var i=0;i<5;i++){
    var ang=i*Math.PI*2/5,r=80+Math.random()*80;
    var v=Math.sqrt(G*200*5/(r*2))*(0.8+Math.random()*0.4);
    bodies.push(makeBody('Body '+(i+1),r*Math.cos(ang),r*Math.sin(ang),-v*Math.sin(ang),v*Math.cos(ang),150+Math.random()*300,6+Math.random()*6,bodyColors[i]));
  }
}

// Reset the world to a named preset: clear counters and history, highlight the
// matching card, build the bodies, drop trails, and recentre the camera.
function loadPreset(name,btn){
  nextId=0;simTime=0;energyHistory=[];selectedIdx=-1;
  document.querySelectorAll('.pcard').forEach(function(b){b.classList.remove('active');});
  if(btn) btn.classList.add('active');
  else{
    var map={laplace:0,binary:1,figure8:2,solar:3,chaos:4};
    var cards=document.querySelectorAll('.pcard');
    if(map[name]!==undefined&&cards[map[name]]) cards[map[name]].classList.add('active');
  }
  currentPreset=name;
  if(name==='laplace')laplace();
  else if(name==='binary')binaryStar();
  else if(name==='figure8')figure8();
  else if(name==='solar')miniSolar();
  else if(name==='chaos')chaos5();
  for(var b of bodies)b.trail=[];
  centerCamera();updateBodyList();
  if(window.innerWidth<=980) closeDrawers();
}
// Wipe the scene down to a single fixed star, ready for hand-launched bodies.
function clearBodies(){
  nextId=0;simTime=0;energyHistory=[];selectedIdx=-1;
  bodies=[makeBody('Star',0,0,0,0,5000,18,'#ffeebb',true)];
  document.querySelectorAll('.pcard').forEach(function(b){b.classList.remove('active');});
  currentPreset='';
  updateBodyList();centerCamera();
}

/* PHYSICS */
// Sum the pairwise gravitational force on every body, then derive acceleration.
// Each unordered pair is visited once (j starts at i+1) and Newton's third law
// applies the equal-and-opposite force to both members.
function computeForces(){
  // Clear last frame's accumulated force before summing again.
  for(var i=0;i<bodies.length;i++){bodies[i].fx=0;bodies[i].fy=0;}
  for(var i=0;i<bodies.length;i++){
    for(var j=i+1;j<bodies.length;j++){
      var dx=bodies[j].x-bodies[i].x,dy=bodies[j].y-bodies[i].y;
      var dist2=dx*dx+dy*dy;
      // Softening ε avoids a divide-by-zero and an infinite kick when two bodies
      // nearly coincide; it rounds the potential off at short range (Plummer).
      var softening=4;
      var dist=Math.sqrt(dist2+softening);
      // Softened Newton: F = G·m₁·m₂/(r²+ε); divide by `dist` to get a unit vector.
      var F=G*bodies[i].mass*bodies[j].mass/(dist2+softening);
      var fx=F*dx/dist,fy=F*dy/dist;
      // Third-law pair: i pulled toward j, j pulled the opposite way.
      bodies[i].fx+=fx;bodies[i].fy+=fy;
      bodies[j].fx-=fx;bodies[j].fy-=fy;
    }
  }
  // a = F/m for each body, ready for the integrator's kick.
  for(var i=0;i<bodies.length;i++){
    bodies[i].ax=bodies[i].fx/bodies[i].mass;
    bodies[i].ay=bodies[i].fy/bodies[i].mass;
  }
}
// Advance the system by one velocity-Verlet step of size h. The half-kick /
// drift / recompute / half-kick order makes the scheme symplectic, so energy
// oscillates but does not systematically drift. Fixed bodies never move.
function step(h){
  // Half kick with the old acceleration, then drift positions a full step.
  for(var b of bodies){
    if(b.fixed)continue;
    b.vx+=0.5*b.ax*h;b.vy+=0.5*b.ay*h;
    b.x+=b.vx*h;b.y+=b.vy*h;
  }
  // Recompute acceleration at the new positions.
  computeForces();
  // Second half kick with the fresh acceleration completes the step.
  for(var b of bodies){
    if(b.fixed)continue;
    b.vx+=0.5*b.ax*h;b.vy+=0.5*b.ay*h;
  }
  // Bookkeeping: append to the trail and track the unwrapped orbital angle so the
  // readout can count whole orbits without a ±π jump at the atan2 seam.
  for(var b of bodies){
    b.trail.push([b.x,b.y]);
    if(b.trail.length>trailLen)b.trail.shift();
    var na=Math.atan2(b.y,b.x);
    if(b.lastAngle!==null){
      var da=na-b.lastAngle;
      // Wrap the per-step delta into (−π, π] before accumulating.
      if(da>Math.PI)da-=2*Math.PI;
      if(da<-Math.PI)da+=2*Math.PI;
      b.angle+=da;
    }
    b.lastAngle=na;
  }
  simTime+=h;
}
// Diagnostics for the readouts: total kinetic energy, gravitational potential
// energy, and net linear momentum. A stable integrator keeps ke+pe roughly flat.
function calcEnergy(){
  var ke=0,pe=0,px=0,py=0;
  // Kinetic energy ½mv² and momentum, summed per body.
  for(var b of bodies){
    ke+=0.5*b.mass*(b.vx*b.vx+b.vy*b.vy);
    px+=b.mass*b.vx;py+=b.mass*b.vy;
  }
  // Potential energy −G·m₁·m₂/r summed over pairs (same +4 softening as forces).
  for(var i=0;i<bodies.length;i++){
    for(var j=i+1;j<bodies.length;j++){
      var dx=bodies[j].x-bodies[i].x,dy=bodies[j].y-bodies[i].y;
      var dist=Math.sqrt(dx*dx+dy*dy+4);
      pe-=G*bodies[i].mass*bodies[j].mass/dist;
    }
  }
  return{ke:ke,pe:pe,total:ke+pe,px:px,py:py,pmag:Math.sqrt(px*px+py*py)};
}

/* CANVAS + INPUT */
// Grab the three canvases, size them, and wire every pointer and touch handler.
function initCanvas(){
  canvas=document.getElementById('simCanvas');ctx=canvas.getContext('2d');
  energyCanvas=document.getElementById('energyGraph');energyCtx=energyCanvas.getContext('2d');
  resCanvas=document.getElementById('resonanceCanvas');resCtx=resCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize',resizeCanvas);
  canvas.addEventListener('mousedown',onDown);
  canvas.addEventListener('mousemove',onMove);
  canvas.addEventListener('mouseup',onUp);
  canvas.addEventListener('mouseleave',function(){isPan=false;isDrag=false;document.getElementById('hudInfo').style.display='none';});
  canvas.addEventListener('wheel',onWheel,{passive:false});
  canvas.addEventListener('contextmenu',function(e){e.preventDefault();});
  canvas.addEventListener('touchstart',onTouchStart,{passive:false});
  canvas.addEventListener('touchmove',onTouchMove,{passive:false});
  canvas.addEventListener('touchend',onTouchEnd,{passive:false});
  canvas.addEventListener('touchcancel',onTouchEnd,{passive:false});
}
// Match every canvas backing store to its CSS size times device pixel ratio, so
// drawing stays crisp on high-DPI screens. setTransform bakes the DPR scale in
// once, letting the rest of the code draw in CSS pixels.
function resizeCanvas(){
  var a=document.getElementById('canvasArea'),d=window.devicePixelRatio||1;
  canvas.width=a.clientWidth*d;canvas.height=a.clientHeight*d;
  canvas.style.width=a.clientWidth+'px';canvas.style.height=a.clientHeight+'px';
  ctx.setTransform(d,0,0,d,0,0);
  if(energyCanvas){
    var eg=energyCanvas.parentElement;
    var ew=eg.clientWidth-32,eh=84;
    energyCanvas.width=ew*d;energyCanvas.height=eh*d;
    energyCanvas.style.width=ew+'px';energyCanvas.style.height=eh+'px';
    energyCtx.setTransform(d,0,0,d,0,0);
  }
  if(resCanvas){
    var rw=resCanvas.parentElement.clientWidth-32,rh=64;
    resCanvas.width=rw*d;resCanvas.height=rh*d;
    resCanvas.style.width=rw+'px';resCanvas.style.height=rh+'px';
    resCtx.setTransform(d,0,0,d,0,0);
  }
}
// World to screen: centre the origin, add the camera pan, scale by zoom.
function worldToScreen(wx,wy){
  var a=document.getElementById('canvasArea');
  return[a.clientWidth/2+camX+wx*camZoom,a.clientHeight/2+camY+wy*camZoom];
}
// The exact inverse, used to turn a click into a world coordinate.
function screenToWorld(sx,sy){
  var a=document.getElementById('canvasArea');
  return[(sx-a.clientWidth/2-camX)/camZoom,(sy-a.clientHeight/2-camY)/camZoom];
}
// Hit test: return the index of the body under a screen point, or −1. `slop` adds
// a pixel margin so small bodies stay easy to grab; radius is un-zoomed to world.
function bodyAt(sx,sy,slop){
  var w=screenToWorld(sx,sy);
  for(var i=0;i<bodies.length;i++){
    var dx=w[0]-bodies[i].x,dy=w[1]-bodies[i].y;
    if(Math.sqrt(dx*dx+dy*dy)<bodies[i].radius/camZoom+(slop||8))return i;
  }
  return -1;
}
// Mouse down: middle/right button (or Alt+left) starts a camera pan; a plain
// left click either selects a body under the cursor or begins a launch-drag.
function onDown(e){
  var rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
  if(e.button===1||e.button===2||(e.button===0&&e.altKey)){
    isPan=true;panSX=e.clientX;panSY=e.clientY;panCX=camX;panCY=camY;canvas.style.cursor='grabbing';return;
  }
  if(e.button===0){
    var hit=bodyAt(mx,my);
    if(hit>=0){selectedIdx=hit;updateBodyList();updateSelPanel();return;}
    isDrag=true;dragSX=mx;dragSY=my;dragCX=mx;dragCY=my;
  }
}
// Mouse move: drag the camera while panning, extend the launch vector while
// dragging, and otherwise show a hover HUD for whatever body is under the cursor.
function onMove(e){
  if(isPan){camX=panCX+(e.clientX-panSX);camY=panCY+(e.clientY-panSY);return;}
  var rect=canvas.getBoundingClientRect();
  if(isDrag){dragCX=e.clientX-rect.left;dragCY=e.clientY-rect.top;}
  var mx=e.clientX-rect.left,my=e.clientY-rect.top;
  var hit=bodyAt(mx,my,20);
  var hud=document.getElementById('hudInfo');
  if(hit>=0){
    var b=bodies[hit],spd=Math.sqrt(b.vx*b.vx+b.vy*b.vy),fmag=Math.sqrt(b.fx*b.fx+b.fy*b.fy);
    hud.innerHTML='<strong>'+b.name+'</strong> m='+b.mass.toFixed(0)+'<br>v='+spd.toFixed(2)+' |F|='+fmag.toFixed(1);
    hud.style.display='block';
  }else{hud.style.display='none';}
}
// Mouse up: end a pan, or on a long-enough drag spawn a new body at the drag
// start with a velocity set by the drag vector (×2 so a short pull throws harder).
function onUp(e){
  if(isPan){isPan=false;canvas.style.cursor='crosshair';return;}
  if(isDrag){
    var ddx=dragCX-dragSX,ddy=dragCY-dragSY;
    if(Math.sqrt(ddx*ddx+ddy*ddy)>DRAG_THRESHOLD){
      var s=screenToWorld(dragSX,dragSY),end=screenToWorld(dragCX,dragCY);
      var vx=(end[0]-s[0])*2,vy=(end[1]-s[1])*2;
      var mass=50+Math.random()*100;
      var color=bodyColors[bodies.length%bodyColors.length];
      bodies.push(makeBody('Body '+nextId,s[0],s[1],vx,vy,mass,5+mass/50,color));
      updateBodyList();
    }
    isDrag=false;
  }
}
// Zoom about a screen point: keep the world point under the cursor fixed by
// re-projecting it after the zoom change and shifting the camera to compensate.
function zoomAt(sx,sy,factor){
  var w=screenToWorld(sx,sy);
  camZoom=Math.max(0.1,Math.min(5,camZoom*factor));
  var s=worldToScreen(w[0],w[1]);
  camX+=sx-s[0];camY+=sy-s[1];
}
// Wheel up zooms in, wheel down zooms out, about the cursor.
function onWheel(e){
  e.preventDefault();
  var rect=canvas.getBoundingClientRect();
  zoomAt(e.clientX-rect.left,e.clientY-rect.top,e.deltaY>0?0.9:1.1);
}
// Button zoom controls zoom about the canvas centre.
function zoomIn(){var a=document.getElementById('canvasArea');zoomAt(a.clientWidth/2,a.clientHeight/2,1.2);}
function zoomOut(){var a=document.getElementById('canvasArea');zoomAt(a.clientWidth/2,a.clientHeight/2,1/1.2);}
// Reset pan and zoom to the default framing.
function centerCamera(){camX=0;camY=0;camZoom=1;}

// Touch state machine: one finger selects or launches, two fingers pinch-zoom
// and pan. lastDist/lastCx/lastCy hold the previous gesture frame for deltas.
var touch={mode:null,lastDist:0,lastCx:0,lastCy:0};
// Touch start: classify the gesture. One finger on a body selects it; one on
// empty space starts a launch-drag; two fingers begin a pinch.
function onTouchStart(e){
  e.preventDefault();
  var rect=canvas.getBoundingClientRect();
  if(e.touches.length===1){
    var t=e.touches[0],mx=t.clientX-rect.left,my=t.clientY-rect.top;
    var hit=bodyAt(mx,my,18);
    if(hit>=0){selectedIdx=hit;updateBodyList();updateSelPanel();touch.mode='select';return;}
    touch.mode='drag';isDrag=true;dragSX=mx;dragSY=my;dragCX=mx;dragCY=my;
  }else if(e.touches.length===2){
    touch.mode='pinch';isDrag=false;
    var t0=e.touches[0],t1=e.touches[1];
    var dx=t1.clientX-t0.clientX,dy=t1.clientY-t0.clientY;
    touch.lastDist=Math.sqrt(dx*dx+dy*dy);
    touch.lastCx=(t0.clientX+t1.clientX)/2;touch.lastCy=(t0.clientY+t1.clientY)/2;
  }
}
// Touch move: extend the launch vector, or apply pinch zoom about the pinch
// midpoint plus a pan by the midpoint's own drift between frames.
function onTouchMove(e){
  e.preventDefault();
  var rect=canvas.getBoundingClientRect();
  if(touch.mode==='drag'&&e.touches.length===1){
    var t=e.touches[0];dragCX=t.clientX-rect.left;dragCY=t.clientY-rect.top;
  }else if(touch.mode==='pinch'&&e.touches.length===2){
    var t0=e.touches[0],t1=e.touches[1];
    var dx=t1.clientX-t0.clientX,dy=t1.clientY-t0.clientY;
    var dist=Math.sqrt(dx*dx+dy*dy);
    var cx=(t0.clientX+t1.clientX)/2,cy=(t0.clientY+t1.clientY)/2;
    var pivotX=cx-rect.left,pivotY=cy-rect.top;
    if(touch.lastDist>0) zoomAt(pivotX,pivotY,dist/touch.lastDist);
    camX+=cx-touch.lastCx;camY+=cy-touch.lastCy;
    touch.lastDist=dist;touch.lastCx=cx;touch.lastCy=cy;
  }
}
// Touch end: on lift after a long-enough one-finger drag, spawn a body just as
// the mouse path does; clear the gesture mode once all fingers are up.
function onTouchEnd(e){
  e.preventDefault();
  if(touch.mode==='drag'&&e.touches.length===0){
    var ddx=dragCX-dragSX,ddy=dragCY-dragSY;
    if(Math.sqrt(ddx*ddx+ddy*ddy)>DRAG_THRESHOLD){
      var s=screenToWorld(dragSX,dragSY),end=screenToWorld(dragCX,dragCY);
      var vx=(end[0]-s[0])*2,vy=(end[1]-s[1])*2;
      var mass=50+Math.random()*100;
      var color=bodyColors[bodies.length%bodyColors.length];
      bodies.push(makeBody('Body '+nextId,s[0],s[1],vx,vy,mass,5+mass/50,color));
      updateBodyList();
    }
    isDrag=false;
  }
  if(e.touches.length===0)touch.mode=null;
}

/* RENDERING */
// Draw one full frame back to front: background, starfield, grid, gravity field,
// force lines, trails, bodies with vectors, then the live launch preview.
function render(){
  var w=canvas.clientWidth,h=canvas.clientHeight;
  ctx.fillStyle='#060810';ctx.fillRect(0,0,w,h);

  // Starfield: generated once and cached on the function object, then panned with
  // the camera so it parallaxes with the world instead of sticking to the screen.
  if(!render.stars){render.stars=[];for(var i=0;i<120;i++)render.stars.push([Math.random()*2000-1000,Math.random()*2000-1000,Math.random()*1.5+0.5,Math.random()*0.3+0.1]);}
  for(var s of render.stars){var sp=worldToScreen(s[0],s[1]);ctx.fillStyle='rgba(180,200,255,'+s[3]+')';ctx.beginPath();ctx.arc(sp[0],sp[1],s[2]*camZoom,0,Math.PI*2);ctx.fill();}

  // Reference grid: spacing snaps coarser as you zoom out so line density stays
  // readable; only lines inside the viewport are drawn.
  if(showGrid){
    var gridStep=100;if(camZoom<0.3)gridStep=500;else if(camZoom<0.6)gridStep=200;else if(camZoom>2)gridStep=50;
    ctx.strokeStyle='rgba(150,200,255,0.04)';ctx.lineWidth=1;
    var wTL=screenToWorld(0,0),wBR=screenToWorld(w,h);
    var gx1=Math.floor(wTL[0]/gridStep)*gridStep,gx2=Math.ceil(wBR[0]/gridStep)*gridStep;
    var gy1=Math.floor(wTL[1]/gridStep)*gridStep,gy2=Math.ceil(wBR[1]/gridStep)*gridStep;
    for(var gx=gx1;gx<=gx2;gx+=gridStep){var sp=worldToScreen(gx,0);ctx.beginPath();ctx.moveTo(sp[0],0);ctx.lineTo(sp[0],h);ctx.stroke();}
    for(var gy=gy1;gy<=gy2;gy+=gridStep){var sp=worldToScreen(0,gy);ctx.beginPath();ctx.moveTo(0,sp[1]);ctx.lineTo(w,sp[1]);ctx.stroke();}
  }

  // Gravity field: sample the acceleration a test mass would feel at each 24px
  // cell centre and shade the cell by field strength. Larger softening (+100)
  // than the physics keeps the display smooth near bodies.
  if(showField&&bodies.length>0){
    var step=24;
    for(var sx=0;sx<w;sx+=step){
      for(var sy=0;sy<h;sy+=step){
        var wp=screenToWorld(sx+step/2,sy+step/2),fx=0,fy=0;
        for(var b of bodies){
          var dx=b.x-wp[0],dy=b.y-wp[1],d2=dx*dx+dy*dy+100;
          var f=G*b.mass/d2,d=Math.sqrt(d2);
          fx+=f*dx/d;fy+=f*dy/d;
        }
        var mag=Math.sqrt(fx*fx+fy*fy);
        var alpha=Math.min(0.15,mag*0.0003);
        ctx.fillStyle='rgba(150,200,255,'+alpha+')';
        ctx.fillRect(sx,sy,step,step);
      }
    }
  }

  // Force lines: a dashed link between every pair, brighter and thicker where the
  // mutual pull is stronger, so the dominant interactions stand out.
  if(showLines){
    for(var i=0;i<bodies.length;i++){
      for(var j=i+1;j<bodies.length;j++){
        var a=worldToScreen(bodies[i].x,bodies[i].y),b2=worldToScreen(bodies[j].x,bodies[j].y);
        var dx=bodies[j].x-bodies[i].x,dy=bodies[j].y-bodies[i].y;
        var d=Math.sqrt(dx*dx+dy*dy+4);
        var F=G*bodies[i].mass*bodies[j].mass/(d*d);
        var alpha=Math.min(0.5,F*0.00005);
        ctx.strokeStyle='rgba(255,200,50,'+alpha+')';
        ctx.lineWidth=Math.min(3,F*0.00003+0.5);
        ctx.setLineDash([4,6]);
        ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b2[0],b2[1]);ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Banded trails: split each trail into 6 age bands and fade the older bands so
  // the path reads as a comet tail, oldest points faintest.
  // Banded trails
  if(showTrails){
    var BANDS=6;
    ctx.lineWidth=1.6;
    for(var b of bodies){
      var n=b.trail.length;if(n<2)continue;
      for(var band=0;band<BANDS;band++){
        var startT=Math.floor(band*n/BANDS),endT=Math.floor((band+1)*n/BANDS);
        if(endT<=startT+1)continue;
        var alpha=(band+1)/BANDS*0.6;
        ctx.strokeStyle=hexToRGBA(b.color,alpha);
        ctx.beginPath();
        var p=worldToScreen(b.trail[startT][0],b.trail[startT][1]);
        ctx.moveTo(p[0],p[1]);
        for(var t=startT+1;t<endT&&t<n;t++){
          var q=worldToScreen(b.trail[t][0],b.trail[t][1]);
          ctx.lineTo(q[0],q[1]);
        }
        ctx.stroke();
      }
    }
  }

  // Bodies: a soft outer glow, a lit sphere (radial gradient shifted toward the
  // light), a dashed ring on the selected body, a name label, then the vectors.
  for(var i=0;i<bodies.length;i++){
    var b=bodies[i],sp=worldToScreen(b.x,b.y),r=b.radius*camZoom;
    var grad=ctx.createRadialGradient(sp[0],sp[1],0,sp[0],sp[1],r*3);
    grad.addColorStop(0,hexToRGBA(b.color,0.15));grad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=grad;ctx.beginPath();ctx.arc(sp[0],sp[1],r*3,0,Math.PI*2);ctx.fill();
    var bg=ctx.createRadialGradient(sp[0]-r*0.3,sp[1]-r*0.3,0,sp[0],sp[1],r);
    bg.addColorStop(0,lighten(b.color,40));bg.addColorStop(1,b.color);
    ctx.fillStyle=bg;ctx.beginPath();ctx.arc(sp[0],sp[1],r,0,Math.PI*2);ctx.fill();
    if(i===selectedIdx){
      ctx.strokeStyle=hexToRGBA(b.color,0.85);ctx.lineWidth=2;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.arc(sp[0],sp[1],r+6,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    if(camZoom>0.3){
      ctx.fillStyle=hexToRGBA(b.color,0.75);ctx.font='600 11px JetBrains Mono';
      ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(b.name,sp[0],sp[1]+r+4);
    }
    // Fixed bodies carry no motion vectors. The per-vector constants (0.005,
    // 0.15, 2) only scale each quantity to a comparable on-screen arrow length.
    if(b.fixed)continue;
    if(showForce)drawArrow(ctx,sp[0],sp[1],b.fx*vecScale*0.005,b.fy*vecScale*0.005,'rgba(92,216,232,0.85)',2);
    if(showVel)drawArrow(ctx,sp[0],sp[1],b.vx*vecScale*0.15,b.vy*vecScale*0.15,'rgba(122,216,122,0.85)',2);
    if(showAcc)drawArrow(ctx,sp[0],sp[1],b.ax*vecScale*2,b.ay*vecScale*2,'rgba(216,112,200,0.85)',2);
  }

  // Launch preview: while dragging, draw the aim line, origin dot, velocity arrow,
  // and a speed readout so the throw can be judged before release.
  if(isDrag){
    ctx.strokeStyle='rgba(255,200,50,0.55)';ctx.lineWidth=2;ctx.setLineDash([6,6]);
    ctx.beginPath();ctx.moveTo(dragSX,dragSY);ctx.lineTo(dragCX,dragCY);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(255,200,50,0.35)';ctx.beginPath();ctx.arc(dragSX,dragSY,7,0,Math.PI*2);ctx.fill();
    drawArrow(ctx,dragSX,dragSY,(dragCX-dragSX)*0.8,(dragCY-dragSY)*0.8,'rgba(122,216,122,0.55)',2);
    ctx.fillStyle='rgba(255,200,50,0.7)';ctx.font='600 12px JetBrains Mono';ctx.textAlign='left';ctx.textBaseline='bottom';
    var vLen=Math.sqrt(Math.pow(dragCX-dragSX,2)+Math.pow(dragCY-dragSY,2))*2/camZoom;
    ctx.fillText('v='+vLen.toFixed(0),dragCX+10,dragCY-6);
  }
}

// Draw a vector as a line plus a filled arrowhead. Very short vectors are
// skipped and long ones are clamped to maxLen so the display never overflows.
function drawArrow(ctx,x,y,dx,dy,color,width){
  var len=Math.sqrt(dx*dx+dy*dy);
  if(len<2)return;
  var maxLen=160;if(len>maxLen){dx=dx/len*maxLen;dy=dy/len*maxLen;len=maxLen;}
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx,y+dy);ctx.stroke();
  var headLen=Math.min(10,len*0.3),ang=Math.atan2(dy,dx);
  ctx.beginPath();ctx.moveTo(x+dx,y+dy);
  ctx.lineTo(x+dx-headLen*Math.cos(ang-0.4),y+dy-headLen*Math.sin(ang-0.4));
  ctx.lineTo(x+dx-headLen*Math.cos(ang+0.4),y+dy-headLen*Math.sin(ang+0.4));
  ctx.closePath();ctx.fill();
}

// Plot the recent KE, PE, and total-energy history as three traces, auto-scaled
// to the min and max across all three so the flatness of `total` is visible.
function renderEnergyGraph(){
  var w=energyCanvas.clientWidth,h=energyCanvas.clientHeight;
  energyCtx.fillStyle='rgba(10,12,20,0.85)';energyCtx.fillRect(0,0,w,h);
  if(energyHistory.length<2)return;
  var minE=Infinity,maxE=-Infinity;
  for(var e of energyHistory){minE=Math.min(minE,e.ke,e.pe,e.total);maxE=Math.max(maxE,e.ke,e.pe,e.total);}
  var range=maxE-minE||1;
  // Map one series to the canvas: x by sample index, y inverted so up is larger.
  function plotLine(key,color){
    energyCtx.strokeStyle=color;energyCtx.lineWidth=1.3;energyCtx.beginPath();
    for(var i=0;i<energyHistory.length;i++){
      var x=i/(energyHistory.length-1)*w,y=h-(energyHistory[i][key]-minE)/range*h;
      i===0?energyCtx.moveTo(x,y):energyCtx.lineTo(x,y);
    }energyCtx.stroke();
  }
  plotLine('pe','rgba(232,116,102,0.7)');plotLine('ke','rgba(150,200,255,0.7)');plotLine('total','rgba(255,200,50,0.92)');
}
// Resonance dial: place each orbiting body as a dot at its current polar angle on
// one shared circle. Bodies in resonance keep a repeating angular pattern.
function renderResonance(){
  var w=resCanvas.clientWidth,h=resCanvas.clientHeight||64;
  resCtx.fillStyle='rgba(10,12,20,0.85)';resCtx.fillRect(0,0,w,h);
  var cx=w/2,cy=h/2,r=h/2-8;
  resCtx.strokeStyle='rgba(150,200,255,0.14)';resCtx.lineWidth=1;
  resCtx.beginPath();resCtx.arc(cx,cy,r,0,Math.PI*2);resCtx.stroke();
  for(var i=1;i<bodies.length;i++){
    var b=bodies[i],ang=Math.atan2(b.y,b.x);
    var bx=cx+r*Math.cos(ang),by=cy+r*Math.sin(ang);
    resCtx.fillStyle=b.color;resCtx.beginPath();resCtx.arc(bx,by,4,0,Math.PI*2);resCtx.fill();
    resCtx.strokeStyle=hexToRGBA(b.color,0.35);resCtx.beginPath();resCtx.moveTo(cx,cy);resCtx.lineTo(bx,by);resCtx.stroke();
  }
}

/* UI */
// Flip a boolean display flag (named on the global scope) and its switch styling.
function tog(el,prop){window[prop]=!window[prop];el.classList.toggle('on',window[prop]);}
// Toggle the run state and update the Play/Pause button and status readout.
function togglePause(){
  paused=!paused;
  var btn=document.getElementById('playBtn');
  btn.innerHTML=paused?'\u25b6 Play':'\u23f8 Pause';
  btn.classList.toggle('active',paused);
  var st=document.getElementById('simStatus');
  st.textContent=paused?'PAUSED':'RUNNING';
  st.style.color=paused?'var(--yellow)':'var(--green)';
}
// Single-step: pause if running, then advance exactly one base dt for inspection.
function stepOnce(){
  if(!paused){
    paused=true;
    document.getElementById('playBtn').innerHTML='\u25b6 Play';
    document.getElementById('playBtn').classList.add('active');
    var st=document.getElementById('simStatus');st.textContent='PAUSED';st.style.color='var(--yellow)';
  }
  step(dt);
}
// Slider 0..40 maps to a 0..4\u00d7 time multiplier (the loop sub-steps to stay stable).
function setTimeScale(v){timeScale=v/10;document.getElementById('tsVal').textContent=timeScale.toFixed(1)+'\u00d7';}

// Rebuild the left-panel body list: one clickable card per body, with a delete
// button on all but the first, and refresh the body-count readouts.
function updateBodyList(){
  var html='';
  for(var i=0;i<bodies.length;i++){
    var b=bodies[i],sel=i===selectedIdx?' selected':'';
    html+='<div class="body-card'+sel+'" onclick="selectedIdx='+i+';updateBodyList();updateSelPanel()"><div class="body-swatch" style="background:'+b.color+'"></div><div class="body-info"><div class="body-name" style="color:'+b.color+'">'+b.name+'</div><div class="body-stats">m='+b.mass.toFixed(0)+' r='+Math.sqrt(b.x*b.x+b.y*b.y).toFixed(0)+'</div></div>'+(i>0?'<button class="body-del" onclick="event.stopPropagation();bodies.splice('+i+',1);if(selectedIdx>='+i+')selectedIdx--;updateBodyList();">\u00d7</button>':'')+'</div>';
  }
  document.getElementById('bodyList').innerHTML=html;
  document.getElementById('bodyCount').textContent=bodies.length;
  document.getElementById('hud-bodies').textContent=bodies.length;
}

// Fill the right-panel readout for the selected body: mass, position, distance,
// speed, force, acceleration, angular momentum, an estimated period, and orbits.
function updateSelPanel(){
  var el=document.getElementById('selBody');
  if(selectedIdx<0||selectedIdx>=bodies.length){el.innerHTML='<span class="hint">Click a body to inspect.</span>';return;}
  var b=bodies[selectedIdx],spd=Math.sqrt(b.vx*b.vx+b.vy*b.vy),fmag=Math.sqrt(b.fx*b.fx+b.fy*b.fy);
  var dist=Math.sqrt(b.x*b.x+b.y*b.y);
  // Crude period estimate: circumference of the current radius over current speed.
  // Exact only for a circular orbit; a quick gauge otherwise.
  var period=dist>1&&spd>0.01?2*Math.PI*dist/spd:0;
  var Lz=b.mass*(b.x*b.vy-b.y*b.vx); // 2D angular momentum L_z = m(x·vy − y·vx)
  el.innerHTML='<div style="color:'+b.color+';font-size:13.5px;font-weight:700;margin-bottom:7px">'+b.name+'</div>'+
    '<div class="readout"><span class="rl">Mass m</span><span class="rv orange">'+b.mass.toFixed(0)+'</span></div>'+
    '<div class="readout"><span class="rl">Position</span><span class="rv">('+b.x.toFixed(1)+', '+b.y.toFixed(1)+')</span></div>'+
    '<div class="readout"><span class="rl">Distance r</span><span class="rv blue">'+dist.toFixed(1)+'</span></div>'+
    '<div class="readout"><span class="rl">Speed v</span><span class="rv green">'+spd.toFixed(2)+'</span></div>'+
    '<div class="readout"><span class="rl">|Force F|</span><span class="rv cyan">'+fmag.toFixed(1)+'</span></div>'+
    '<div class="readout"><span class="rl">|Accel|</span><span class="rv">'+Math.sqrt(b.ax*b.ax+b.ay*b.ay).toFixed(3)+'</span></div>'+
    '<div class="readout"><span class="rl">Ang. mom. L</span><span class="rv magenta">'+fmt(Lz)+'</span></div>'+
    '<div class="readout"><span class="rl">\u2248 Period T</span><span class="rv yellow">'+(period>0?period.toFixed(1):'N/A')+'</span></div>'+
    '<div class="readout"><span class="rl">Orbits</span><span class="rv">'+(Math.abs(b.angle)/(2*Math.PI)).toFixed(2)+'</span></div>'+
    (b.fixed?'<div style="font-size:11px;color:var(--yellow);margin-top:6px;font-weight:600">FIXED: not affected by gravity</div>':'');
}

// Mobile drawers: open one side panel, close the other, and show the backdrop.
function toggleDrawer(side){
  var panel=document.getElementById(side==='l'?'panelL':'panelR');
  var fab=document.getElementById(side==='l'?'fabL':'fabR');
  var other=document.getElementById(side==='l'?'panelR':'panelL');
  var otherFab=document.getElementById(side==='l'?'fabR':'fabL');
  var backdrop=document.getElementById('drawerBackdrop');
  var opening=!panel.classList.contains('open');
  other.classList.remove('open');otherFab.classList.remove('open');
  panel.classList.toggle('open',opening);
  fab.classList.toggle('open',opening);
  backdrop.classList.toggle('show',panel.classList.contains('open')||other.classList.contains('open'));
}
// Close both drawers and hide the backdrop (called on backdrop tap or preset load).
function closeDrawers(){
  ['panelL','panelR','fabL','fabR'].forEach(function(id){document.getElementById(id).classList.remove('open');});
  document.getElementById('drawerBackdrop').classList.remove('show');
}

// Keyboard shortcuts: space pauses, +/− zoom, c centres, r reloads the preset,
// digits 1..5 load a preset. Ignored while typing in an input.
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT')return;
  if(e.code==='Space'){e.preventDefault();togglePause();}
  else if(e.key==='+'||e.key==='='){zoomIn();}
  else if(e.key==='-'||e.key==='_'){zoomOut();}
  else if(e.key==='c'||e.key==='C'){centerCamera();}
  else if(e.key==='r'||e.key==='R'){if(currentPreset)loadPreset(currentPreset);}
  else if(e.key>='1'&&e.key<='5'){
    var presets=['laplace','binary','figure8','solar','chaos'];
    loadPreset(presets[+e.key-1]);
  }
});

// Color helpers. hexToRGBA turns a #rrggbb hex plus alpha into an rgba() string.
function hexToRGBA(hex,a){
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return'rgba('+r+','+g+','+b+','+a+')';
}
// lighten raises each channel by amt (clamped) for the lit side of a body.
function lighten(hex,amt){
  var r=Math.min(255,parseInt(hex.slice(1,3),16)+amt),g=Math.min(255,parseInt(hex.slice(3,5),16)+amt),b=Math.min(255,parseInt(hex.slice(5,7),16)+amt);
  return'#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
}
// Compact number format: fixed for small magnitudes, exponential past 1000.
function fmt(n){return Math.abs(n)<1000?n.toFixed(2):n.toExponential(2);}

// The animation loop, driven by requestAnimationFrame.
var frameCount=0;
// One frame: sub-step the physics, draw, and every 3rd frame refresh the readouts
// and graphs. Sub-stepping splits the scaled step into pieces so a large time
// scale does not blow up the integrator with one oversized h.
function loop(){
  if(!paused){
    var substeps=Math.max(1,Math.round(timeScale));
    var h=dt*timeScale/substeps;
    for(var s=0;s<substeps;s++)step(h);
    // Refresh forces after the last step so drawn vectors match current positions.
    computeForces();
  }
  render();
  // Throttle the expensive readout/graph updates to one frame in three.
  if(frameCount%3===0){
    var e=calcEnergy();
    document.getElementById('eKin').textContent=fmt(e.ke);
    document.getElementById('ePot').textContent=fmt(e.pe);
    document.getElementById('eTotal').textContent=fmt(e.total);
    document.getElementById('eMom').textContent=fmt(e.pmag);
    document.getElementById('eMomX').textContent=fmt(e.px);
    document.getElementById('eMomY').textContent=fmt(e.py);
    document.getElementById('hud-dt').textContent=(dt*timeScale).toFixed(4);
    document.getElementById('hud-time').textContent=simTime.toFixed(1);
    energyHistory.push({ke:e.ke,pe:e.pe,total:e.total});
    if(energyHistory.length>maxEnergyPts)energyHistory.shift();
    renderEnergyGraph();renderResonance();updateSelPanel();
  }
  frameCount++;
  requestAnimationFrame(loop);
}

// Boot once the DOM is ready: set up canvases, load the default preset, prime the
// forces so the first frame has vectors, populate the list, and start the loop.
function init(){
  initCanvas();
  laplace();
  computeForces();
  updateBodyList();
  centerCamera();
  loop();
}
document.addEventListener('DOMContentLoaded',init);
