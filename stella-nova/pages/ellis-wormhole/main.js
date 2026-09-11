// ============================================================================
//  ELLIS WORMHOLE  ·  interactive geodesic ray tracer
// ----------------------------------------------------------------------------
//  A single fullscreen quad carries the wormhole fragment shader, which bends
//  each pixel's view ray through the Ellis metric (see shaders/wormhole.frag).
//  This file owns everything around that draw: it builds the GL program, keeps
//  the camera and wormhole parameters, turns pointer/keyboard/touch input into
//  an orbit + look-around + fly-through camera, drives an auto-descent through
//  the throat, draws a 2D throat minimap on a side canvas, and renders the
//  KaTeX metric equations.
//
//  RENDER + STATE FLOW
//  -------------------
//      input (drag / wheel / keys / sliders) ─▶ camera + throat state
//                                                     │
//      frame(): build camera basis (orbit ∘ look) ─▶ set uniforms ─▶ drawArrays
//                                                     └─▶ drawMinimap()
//
//  CAMERA MODEL
//  ------------
//      camL   signed distance along the throat axis; sign picks the universe
//             (l > 0 = Universe A, l < 0 = Universe B). |camL| is the range.
//      orbit  orbYaw / orbPitch place the camera on a sphere of radius |camL|.
//      look   lookYaw / lookPitch rotate the view direction in place.
//      descent  auto fly-through: advances camL, easing near the throat.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      shader load .......... "await fetch"        fetch .glsl before build
//      GL setup ............. "compile"            compile, link, quad, uniforms
//      state ................ "let throatK"        camera + wormhole tunables
//      spin ................. "function pauseSpin" idle auto-spin + resume timer
//      toggles .............. "window.toggle"      button-bound feature switches
//      descent .............. "toggleDescend"      auto fly-through the throat
//      input ................ "addEventListener('mousedown'" drag / touch / wheel
//      sliders .............. "getElementById('zoomSlider')" K / L / range wiring
//      resize ............... "function resize"    render at a fraction of DPR
//      minimap .............. "function drawMinimap" throat cross-section canvas
//      frame loop ........... "function frame"     camera basis + uniforms + draw
//      equations ............ "function renderEqs" KaTeX metric / throat / T
// ============================================================================
(async () => {
// Shader source lives in real .glsl files. Fetch both before building the
// program so the rest of init runs in its original synchronous order.
const VS = await (await fetch(new URL('shaders/wormhole.vert.glsl', document.baseURI))).text();
const FS = await (await fetch(new URL('shaders/wormhole.frag.glsl', document.baseURI))).text();

// WebGL2 context on the main canvas; the page hard-requires it.
const canvas=document.getElementById('c');
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});
if(!gl){document.body.innerHTML='<h1 style="color:red;padding:2em">WebGL 2 required</h1>';throw '';}
// Compile one shader stage; log and return null on failure.
function compile(src,type){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}return s;}
const vs=compile(VS,gl.VERTEX_SHADER),fs=compile(FS,gl.FRAGMENT_SHADER);
const prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);
gl.bindAttribLocation(prog,0,'a_pos');gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS))console.error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
// The fullscreen quad (triangle strip) that the fragment shader draws over.
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
// Cache every uniform location once, keyed by name, for the frame loop.
const U={};
['u_res','u_camPos','u_camFwd','u_camRight','u_camUp','u_focalLen',
 'u_throatK','u_throatA','u_discInner','u_discOuter',
 'u_dl','u_maxSteps','u_escapeR','u_useGeodesic','u_useRK4','u_showDisc','u_showGlow','u_bgMode','u_camL'
].forEach(n=>U[n]=gl.getUniformLocation(prog,n));

// Wormhole shape: throat radius K and flat-throat half-width A (shader k, a).
let throatK=1.5,throatA=0.5;
// Orbit angles (camera position on a sphere) and look angles (view rotation).
let orbYaw=0,orbPitch=0.15;
let lookYaw=0,lookPitch=0;
// Signed axial distance; its sign selects the universe. Focal length is fixed.
let camL=20;
const FOCAL=700;
// Feature switches, each mirrored to a shader uniform and a button state.
let useGeodesic=true,useRK4=false,showDisc=false,showGlow=true,bgMode=0;
// Integrator budget: base step, max steps, and escape-radius multiplier.
let baseDl=0.12,maxSteps=2048,escMul=50;
// Idle auto-spin: on until the user interacts, then resumed after a delay.
let autoSpin=true,spinEnabled=true;
const SPIN_SPEED=0.0008;
var spinTimer=null;
const SPIN_RESUME_MS=4000;

// Any interaction pauses the auto-spin (and cancels a descent), then arms a
// timer to resume spinning after the user goes idle.
function pauseSpin(){autoSpin=false;if(descending){descending=false;var pb=document.getElementById('playBtn');if(pb){pb.classList.remove('on');pb.textContent='\u25B6';}}if(spinTimer)clearTimeout(spinTimer);
  if(spinEnabled)spinTimer=setTimeout(function(){autoSpin=true;},SPIN_RESUME_MS);
  document.getElementById('hint').style.opacity='0';}

// Master spin switch, distinct from the idle pause.
window.toggleSpin=function(){spinEnabled=!spinEnabled;setBtn('btnSpin',spinEnabled);
  if(spinEnabled)autoSpin=true;else{autoSpin=false;if(spinTimer){clearTimeout(spinTimer);spinTimer=null;}}};
// Quality presets pick the integrator step budget.
var qualitySteps=[512,2048,4096],qualityLabels=['btnQLow','btnQMed','btnQHigh'];
window.setQuality=function(q){maxSteps=qualitySteps[q];qualityLabels.forEach(function(id,i){document.getElementById(id).classList.toggle('on',i===q);});};

// Dismiss the GPU-load gate and reveal the interface; on mobile the equations
// start collapsed and the minimap stays hidden.
window.dismissWarn=function(){
  document.getElementById('gpuWarn').classList.add('hide');
  document.getElementById('ctrlWrap').style.display='flex';
  document.getElementById('traverseBar').style.display='flex';
  var mob=window.innerWidth<768;
  document.getElementById('eqPanel').style.display='flex';
  if(mob){
    // Collapse equations on mobile
    var p=document.getElementById('eqPanel');
    p.classList.add('collapsed');
    document.getElementById('eqToggleBtn').textContent='+';
  } else {
    document.getElementById('minimap').style.display='block';
  }
};

// Set a button's on/off classes to match a boolean.
function setBtn(id,on){var el=document.getElementById(id);if(!el)return;el.classList.toggle('on',on);el.classList.toggle('off',!on);}
// Feature toggles: each flips a state flag the frame loop pushes to the shader.
window.toggleGeodesic=function(){useGeodesic=!useGeodesic;setBtn('btnGeodesic',useGeodesic);};
window.toggleRK4=function(){useRK4=!useRK4;setBtn('btnRK4',useRK4);};
window.toggleDisc=function(){showDisc=!showDisc;setBtn('btnDisc',showDisc);};
window.toggleGlow=function(){showGlow=!showGlow;setBtn('btnGlow',showGlow);};
window.setBg=function(m){bgMode=m;['bgStars','bgGrid','bgUV','bgNeb','bgRings'].forEach(function(id,i){var el=document.getElementById(id);if(el){el.classList.toggle('on',i===m);}});};
window.toggleEqPanel=function(){var p=document.getElementById('eqPanel'),b=document.getElementById('eqToggleBtn');p.classList.toggle('collapsed');b.textContent=p.classList.contains('collapsed')?'+':'−';};

// Auto-descent: fly the camera along the axis, bouncing between the two
// universes at the range limits. Start/stop toggles the play button.
var descending=false,descentDir=0,lastFrameTime=0;
window.toggleDescend=function(){
  if(descending){
    descending=false;
    var pb=document.getElementById('playBtn');if(pb){pb.classList.remove('on');pb.textContent='\u25B6';}
    return;
  }
  pauseSpin();
  descending=true;
  descentDir=camL>0?-1:1;
  lastFrameTime=performance.now();
  var pb=document.getElementById('playBtn');if(pb){pb.classList.add('on');pb.textContent='\u25A0';}
};
// Advance the descent each frame: speed eases down near the throat (so the
// crossing reads slowly) and reverses direction at the far limits.
function updateDescent(){
  if(!descending)return;
  var now=performance.now();
  var dt=Math.min((now-lastFrameTime)/1000,0.05);
  lastFrameTime=now;
  var dist=Math.abs(camL);
  var throatProximity=dist/(throatK*4.0);
  var speedMult=0.15+0.85*Math.min(1.0,throatProximity*throatProximity);
  var baseSpeed=4.0;
  camL+=descentDir*baseSpeed*speedMult*dt;
  if(descentDir<0&&camL<-18){camL=-18;descentDir=1;}
  if(descentDir>0&&camL>18){camL=18;descentDir=-1;}
  syncSlider();
}
// Mirror camL onto the traverse slider and its readout.
function syncSlider(){document.getElementById('zoomSlider').value=camL.toFixed(1);document.getElementById('zoomVal').textContent=camL.toFixed(1);}

// Pointer input. Plain drag looks around (lookYaw/Pitch); Shift or right-button
// drag orbits the camera (orbYaw/Pitch). Right-click menu is suppressed.
let dragging=false,lmx=0,lmy=0,shiftHeld=false;
window.addEventListener('keydown',function(e){if(e.key==='Shift')shiftHeld=true;});
window.addEventListener('keyup',function(e){if(e.key==='Shift')shiftHeld=false;});
canvas.addEventListener('mousedown',function(e){dragging=true;lmx=e.clientX;lmy=e.clientY;pauseSpin();});
window.addEventListener('mouseup',function(){dragging=false;});
window.addEventListener('mousemove',function(e){if(!dragging)return;
  var dx=(e.clientX-lmx)*0.004,dy=(e.clientY-lmy)*0.004;
  if(shiftHeld||e.buttons===2){orbYaw-=dx;orbPitch-=dy;orbPitch=Math.max(-1.5,Math.min(1.5,orbPitch));}
  else{lookYaw+=dx;lookPitch+=dy;lookPitch=Math.max(-Math.PI*0.95,Math.min(Math.PI*0.95,lookPitch));}
  lmx=e.clientX;lmy=e.clientY;});
canvas.addEventListener('contextmenu',function(e){e.preventDefault();});

// Touch: one finger looks around, two fingers pinch to fly along the axis.
var pinchDist=0;
canvas.addEventListener('touchstart',function(e){e.preventDefault();pauseSpin();
  if(e.touches.length===1){dragging=true;lmx=e.touches[0].clientX;lmy=e.touches[0].clientY;}
  if(e.touches.length===2){dragging=false;pinchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}
},{passive:false});
canvas.addEventListener('touchmove',function(e){e.preventDefault();
  if(e.touches.length===1&&dragging){var t=e.touches[0];var dx=(t.clientX-lmx)*0.004,dy=(t.clientY-lmy)*0.004;
    lookYaw+=dx;lookPitch+=dy;lookPitch=Math.max(-Math.PI*0.95,Math.min(Math.PI*0.95,lookPitch));lmx=t.clientX;lmy=t.clientY;}
  if(e.touches.length===2){var nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    var delta=(pinchDist-nd)*0.05;camL-=delta;camL=Math.max(-60,Math.min(60,camL));
    syncSlider();pinchDist=nd;}
},{passive:false});
canvas.addEventListener('touchend',function(){dragging=false;});

// Wheel flies along the axis, with a step that scales with distance.
canvas.addEventListener('wheel',function(e){e.preventDefault();pauseSpin();
  var speed=Math.max(Math.abs(camL)*0.06,0.3);camL-=e.deltaY>0?speed:-speed;
  camL=Math.max(-60,Math.min(60,camL));syncSlider();},{passive:false});

// Keyboard: arrows orbit, W/S fly in/out, R resets the look direction.
window.addEventListener('keydown',function(e){pauseSpin();var s=0.05;
  if(e.key==='ArrowLeft')orbYaw+=s;if(e.key==='ArrowRight')orbYaw-=s;
  if(e.key==='ArrowUp'){orbPitch=Math.min(orbPitch+s,1.5);}
  if(e.key==='ArrowDown'){orbPitch=Math.max(orbPitch-s,-1.5);}
  if(e.key==='w'||e.key==='W'){camL-=Math.max(Math.abs(camL)*0.04,0.2);camL=Math.max(-60,Math.min(60,camL));syncSlider();}
  if(e.key==='s'||e.key==='S'){camL+=Math.max(Math.abs(camL)*0.04,0.2);camL=Math.max(-60,Math.min(60,camL));syncSlider();}
  if(e.key==='r'||e.key==='R'){lookYaw=0;lookPitch=0;}
});

// Sliders: traverse position (camL), throat radius K, and throat length A.
document.getElementById('zoomSlider').addEventListener('input',function(){camL=+this.value;document.getElementById('zoomVal').textContent=camL.toFixed(1);});
document.getElementById('throatSlider').addEventListener('input',function(){throatK=+this.value;document.getElementById('throatVal').textContent=(+this.value).toFixed(1);});
document.getElementById('lengthSlider').addEventListener('input',function(){throatA=+this.value;document.getElementById('lengthVal').textContent=(+this.value).toFixed(1);});

// Render at a fraction of device resolution (quarter on mobile) since the
// per-pixel geodesic trace is expensive; the canvas is then CSS-scaled up.
function resize(){var dpr=Math.min(window.devicePixelRatio||1,2),mob=window.innerWidth<768,sc=mob?0.25:0.4;
  canvas.width=Math.floor(window.innerWidth*dpr*sc);canvas.height=Math.floor(window.innerHeight*dpr*sc);
  gl.viewport(0,0,canvas.width,canvas.height);document.getElementById('res').textContent=canvas.width+'×'+canvas.height;}
window.addEventListener('resize',resize);resize();

// Minimap: draw the wormhole's embedding surface (the classic funnel) as a 2D
// wireframe on a side canvas, sampling the same r(l) profile the shader uses,
// then plot the camera as a dot coloured by which universe it is in.
var mmCanvas=document.getElementById('minimap'),mmCtx=mmCanvas.getContext('2d');
function drawMinimap(){
  if(window.innerWidth<768)return; // skip on mobile
  var W=mmCanvas.width,H=mmCanvas.height;
  mmCtx.clearRect(0,0,W,H);
  // Sample the profile: at each axial l, radius r(l) and embedding height z(l).
  var k=throatK,a=throatA;
  var NL=50,lMax=20,prof=[];
  for(var i=0;i<=NL;i++){var l=-lMax+i*2*lMax/NL;
    var x=Math.max(0,Math.abs(l)-a),r=Math.sqrt(k*k+x*x);
    var z=Math.abs(l)<=a?l:Math.sign(l)*(a+k*Math.asinh(x/k));
    prof.push({r:r,z:z,l:l});}
  // Revolve the profile around the axis into a surface of quads.
  var NPHI=28,surf=[];
  for(var i=0;i<prof.length;i++){var row=[];
    for(var j=0;j<=NPHI;j++){var phi=j*2*Math.PI/NPHI;
      row.push({x:prof[i].r*Math.cos(phi),y:prof[i].r*Math.sin(phi),z:prof[i].z});}
    surf.push(row);}
  var maxE=0;for(var i=0;i<prof.length;i++){maxE=Math.max(maxE,prof[i].r,Math.abs(prof[i].z));}
  var scX=W*0.72/Math.max(maxE,1),scZ=H*0.30/Math.max(maxE,1);var sc=Math.min(scX,scZ);
  // Slowly rotating tilted orthographic projection for the wireframe.
  var tilt=0.35,rot=performance.now()*0.0002;
  var ct=Math.cos(tilt),st=Math.sin(tilt),cr=Math.cos(rot),sr=Math.sin(rot);
  function proj(p){var pz=p.z*3.0;var rx=p.x*cr-p.y*sr,ry=p.x*sr+p.y*cr;
    var tz=ry*st+pz*ct,ty=ry*ct-pz*st;
    return{x:W/2+rx*sc,y:H/2-tz*sc,d:ty};}
  for(var j=0;j<NPHI;j+=2){mmCtx.beginPath();mmCtx.strokeStyle='rgba(255,255,255,0.28)';mmCtx.lineWidth=1.0;
    for(var i=0;i<surf.length;i++){var p=proj(surf[i][j]);if(i===0)mmCtx.moveTo(p.x,p.y);else mmCtx.lineTo(p.x,p.y);}mmCtx.stroke();}
  for(var i=2;i<surf.length;i+=3){mmCtx.beginPath();
    var side=prof[i].l>=0;
    mmCtx.strokeStyle=side?'rgba(255,200,120,0.35)':'rgba(120,180,255,0.35)';mmCtx.lineWidth=1.0;
    for(var j=0;j<=NPHI;j++){var p=proj(surf[i][j]);if(j===0)mmCtx.moveTo(p.x,p.y);else mmCtx.lineTo(p.x,p.y);}mmCtx.stroke();}
  var ti=Math.floor(NL/2);mmCtx.beginPath();mmCtx.strokeStyle='rgba(100,240,240,0.75)';mmCtx.lineWidth=2.0;
  for(var j=0;j<=NPHI;j++){var p=proj(surf[ti][j]);if(j===0)mmCtx.moveTo(p.x,p.y);else mmCtx.lineTo(p.x,p.y);}mmCtx.stroke();
  var pA=proj({x:0,y:0,z:prof[prof.length-1].z*0.7}),pB=proj({x:0,y:0,z:prof[0].z*0.7});
  mmCtx.font='bold 11px "JetBrains Mono",monospace';mmCtx.textAlign='center';
  mmCtx.fillStyle='rgba(255,200,120,0.7)';mmCtx.fillText('A',pA.x,pA.y-8);
  mmCtx.fillStyle='rgba(120,180,255,0.7)';mmCtx.fillText('B',pB.x,pB.y-8);
  // Place the camera dot on the surface at (r(camL), orbYaw, z(camL)).
  var cx2=Math.max(0,Math.abs(camL)-a),cR=Math.sqrt(k*k+cx2*cx2);
  var cZ=Math.abs(camL)<=a?camL:Math.sign(camL)*(a+k*Math.asinh(cx2/k));
  var cPhi=orbYaw,cam3={x:cR*Math.cos(cPhi),y:cR*Math.sin(cPhi),z:cZ};
  var cp=proj(cam3),dotC=camL>=0?'#ffb850':'#64b4ff';
  mmCtx.fillStyle=dotC;mmCtx.shadowColor=dotC;mmCtx.shadowBlur=10;
  mmCtx.beginPath();mmCtx.arc(cp.x,cp.y,4.5,0,Math.PI*2);mmCtx.fill();mmCtx.shadowBlur=0;
}

// The per-frame loop: apply idle spin and descent, build the camera basis from
// orbit and look angles, derive adaptive step counts from distance, push all
// uniforms, draw the fullscreen quad, and refresh the minimap.
var frames=0,lastT=performance.now();
function frame(){
  var now=performance.now();frames++;
  if(now-lastT>500){document.getElementById('fps').textContent=Math.round(frames/((now-lastT)/1000))+' fps';frames=0;lastT=now;}
  if(autoSpin)orbYaw-=SPIN_SPEED;
  updateDescent();
  if(autoSpin&&!dragging){lookYaw*=0.97;lookPitch*=0.97;if(Math.abs(lookYaw)<0.001)lookYaw=0;if(Math.abs(lookPitch)<0.001)lookPitch=0;}

  // Orbit: place the camera on a sphere of radius |camL|, look toward centre,
  // then build a right/up basis from that forward vector.
  var absL=Math.max(Math.abs(camL),0.1);
  var cx=absL*Math.cos(orbPitch)*Math.cos(orbYaw),cy=absL*Math.sin(orbPitch),cz=absL*Math.cos(orbPitch)*Math.sin(orbYaw);
  var fl=Math.sqrt(cx*cx+cy*cy+cz*cz);
  var fwd=[-cx/fl,-cy/fl,-cz/fl];
  var rl=Math.sqrt(fwd[2]*fwd[2]+fwd[0]*fwd[0]);
  var right=rl>1e-6?[fwd[2]/rl,0,-fwd[0]/rl]:[1,0,0];
  var up=[fwd[1]*right[2]-fwd[2]*right[1],fwd[2]*right[0]-fwd[0]*right[2],fwd[0]*right[1]-fwd[1]*right[0]];

  // Look-around: rotate the forward vector in place by yaw then pitch (a
  // Rodrigues rotation about the right axis), and rebuild right/up to match.
  if(Math.abs(lookYaw)>0.001||Math.abs(lookPitch)>0.001){
    var cy2=Math.cos(lookYaw),sy=Math.sin(lookYaw);
    var nx=fwd[0]*cy2+fwd[2]*sy,nz=-fwd[0]*sy+fwd[2]*cy2;fwd[0]=nx;fwd[2]=nz;
    var cp2=Math.cos(lookPitch),sp=Math.sin(lookPitch);
    var d=fwd[0]*right[0]+fwd[1]*right[1]+fwd[2]*right[2];
    var crx=fwd[1]*right[2]-fwd[2]*right[1],cry=fwd[2]*right[0]-fwd[0]*right[2],crz=fwd[0]*right[1]-fwd[1]*right[0];
    fwd[0]=fwd[0]*cp2+crx*sp+right[0]*d*(1-cp2);fwd[1]=fwd[1]*cp2+cry*sp+right[1]*d*(1-cp2);fwd[2]=fwd[2]*cp2+crz*sp+right[2]*d*(1-cp2);
    var fnl=Math.sqrt(fwd[0]*fwd[0]+fwd[1]*fwd[1]+fwd[2]*fwd[2]);fwd[0]/=fnl;fwd[1]/=fnl;fwd[2]/=fnl;
    rl=Math.sqrt(fwd[2]*fwd[2]+fwd[0]*fwd[0]);right=rl>1e-6?[fwd[2]/rl,0,-fwd[0]/rl]:[1,0,0];
    up=[fwd[1]*right[2]-fwd[2]*right[1],fwd[2]*right[0]-fwd[0]*right[2],fwd[0]*right[1]-fwd[1]*right[0]];
  }

  // Scale the integration step and escape radius with distance, and spend fewer
  // steps when far from the throat, so cost stays roughly constant per frame.
  var scaleR=absL/20.0;var dl=baseDl*scaleR;
  var distFactor=Math.min(1.0,Math.abs(camL)/(throatK*5.0));
  var dynSteps=Math.round(maxSteps*(0.35+0.65*distFactor));
  var steps=Math.max(128,Math.round(dynSteps/Math.max(scaleR,0.5)));
  var escR=escMul*Math.max(scaleR,1.0);
  var universe=camL>=0?'Universe A':'Universe B';
  document.getElementById('mode').textContent=(useGeodesic?(useRK4?'RK4':'Euler'):'Straight')+' · '+universe;
  document.getElementById('hudSub').textContent='Ellis Metric · '+universe;

  // Push all camera and wormhole state into the shader, then draw one quad.
  // shaderL is nudged off exactly zero so the sign (universe) is well defined.
  var shaderL=camL;if(Math.abs(shaderL)<0.1)shaderL=shaderL>=0?0.1:-0.1;
  gl.uniform2f(U.u_res,canvas.width,canvas.height);
  gl.uniform3f(U.u_camPos,cx,cy,cz);
  gl.uniform3f(U.u_camFwd,fwd[0],fwd[1],fwd[2]);gl.uniform3f(U.u_camRight,right[0],right[1],right[2]);gl.uniform3f(U.u_camUp,up[0],up[1],up[2]);
  gl.uniform1f(U.u_focalLen,FOCAL);gl.uniform1f(U.u_throatK,throatK);gl.uniform1f(U.u_throatA,throatA);
  gl.uniform1f(U.u_discInner,throatK*1.05);gl.uniform1f(U.u_discOuter,throatK*4.0);
  gl.uniform1f(U.u_dl,dl);gl.uniform1f(U.u_maxSteps,steps);gl.uniform1f(U.u_escapeR,escR);
  gl.uniform1f(U.u_useGeodesic,useGeodesic?1:0);gl.uniform1f(U.u_useRK4,useRK4?1:0);
  gl.uniform1f(U.u_showDisc,showDisc?1:0);gl.uniform1f(U.u_showGlow,showGlow?1:0);
  gl.uniform1f(U.u_bgMode,bgMode);gl.uniform1f(U.u_camL,shaderL);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  drawMinimap();
  requestAnimationFrame(frame);
}
// Inside the site shell iframe, mark the body so CSS can hide page chrome.
if(window.self!==window.top)document.body.classList.add('in-frame');
frame();

// Render the three metric equations with KaTeX once it has loaded (deferred
// script); retry until it is available. Colours key symbols to the controls.
function renderEqs(){
  if(typeof katex==='undefined'){setTimeout(renderEqs,100);return;}
  var L='#64dce0',K='#ff9860',A='#c896ff',R='#96c8ff',T='#ff6080',G='#90e090';
  katex.render(
    '\\textcolor{'+R+'}{g_{\\mu\\nu}} = \\begin{pmatrix}'
    +' \\textcolor{'+T+'}{-1} & 0 & 0 & 0 \\\\'
    +' 0 & 1 & 0 & 0 \\\\'
    +' 0 & 0 & \\textcolor{'+K+'}{r}^{\\,2} & 0 \\\\'
    +' 0 & 0 & 0 & \\textcolor{'+K+'}{r}^{\\,2}\\!\\sin^2\\!\\theta'
    +' \\end{pmatrix}',
    document.getElementById('eq1'),{throwOnError:false}
  );
  katex.render(
    '\\textcolor{'+K+'}{r}(\\textcolor{'+L+'}{\\ell})'
    +' = \\sqrt{\\textcolor{'+K+'}{k}^{\\,2} + \\bigl[\\max\\!(0,\\;|\\textcolor{'+L+'}{\\ell}| - \\textcolor{'+A+'}{a})\\bigr]^{2}}',
    document.getElementById('eq2'),{throwOnError:false}
  );
  katex.render(
    '\\textcolor{'+T+'}{T^{\\mu}{}_{\\nu}} = \\frac{\\textcolor{'+K+'}{k}^{\\,2}}{8\\pi\\,\\textcolor{'+K+'}{r}^{\\,4}}'
    +' \\begin{pmatrix}'
    +' \\textcolor{'+T+'}{-1} & 0 & 0 & 0 \\\\'
    +' 0 & \\textcolor{'+G+'}{+1} & 0 & 0 \\\\'
    +' 0 & 0 & 0 & 0 \\\\'
    +' 0 & 0 & 0 & 0'
    +' \\end{pmatrix}',
    document.getElementById('eq3'),{throwOnError:false}
  );
}
renderEqs();
})();
