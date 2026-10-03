// ============================================================================
//  ELLIS WORMHOLE  ·  interactive geodesic ray tracer
// ----------------------------------------------------------------------------
//  A single fullscreen quad carries the wormhole fragment shader, which bends
//  each pixel's view ray through the Ellis metric (see shaders/wormhole.frag).
//  This file owns everything around that draw: it builds the GL program, keeps
//  the camera and wormhole parameters, turns pointer/keyboard/touch input into
//  an orbit + look-around + fly-through camera, drives an auto-descent through
//  the throat, draws a 2D embedding map of the camera position on a corner
//  canvas, and renders the MathJax metric equations.
//
//  RENDER + STATE FLOW
//  -------------------
//      input (drag / wheel / keys / sliders) ─▶ camera + throat state
//                                                     │
//      frame(): build camera basis (orbit ∘ look) ─▶ set uniforms ─▶ drawArrays
//                                                     └─▶ drawMinimap(rhat, fwd)
//
//  CAMERA MODEL
//  ------------
//      camL   signed distance along the throat axis; sign picks the universe
//             (l > 0 = Universe A, l < 0 = Universe B). |camL| is the range.
//      orbit  orbYaw / orbPitch place the camera on a sphere of radius |camL|.
//      look   lookYaw / lookPitch rotate the view direction in place.
//      descent  auto fly-through: advances camL, easing near the throat.
//      focal  u_focalLen = FOCAL_PER_H x canvas height, so the view angle
//             does not change when render-scale changes the canvas size.
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
//      resize ............... "RenderScale.create" pixel budget + fps control
//      map .................. "function drawMinimap" embedding map, camera dot + view
//      frame loop ........... "function frame"     camera basis + uniforms + draw
//      equations ............ "function renderEqs" MathJax metric / throat / T
//      screensaver .......... "window.snSaver"     hook for lib/screensaver.js
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
// The tab shell removes this iframe on a page swap. Drop the context so the
// browser does not run out of live WebGL contexts during heavy swapping.
window.addEventListener('pagehide',function(){try{if(gl)gl.getExtension('WEBGL_lose_context').loseContext();}catch(e){}});
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
// Focal length in canvas heights: 1.0 gives a vertical half-angle of 26.6
// degrees at any render size. It was a fixed 700 px, so a 4K canvas
// (1536x864) saw a much wider view than a 1080p one (768x432).
const FOCAL_PER_H=1.0;
// Feature switches, each mirrored to a shader uniform and a button state.
let useGeodesic=true,useRK4=false,showDisc=false,showGlow=true,bgMode=0;
// Integrator budget: base step, max steps, and escape-radius multiplier.
let baseDl=0.12,maxSteps=2048,escMul=50;
// Idle auto-spin: on until the user interacts, then resumed after a delay.
let autoSpin=true,spinEnabled=true;
let SPIN_SPEED=0.0008;   // the screensaver hook lowers it by calm
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
window.setQuality=function(q){maxSteps=qualitySteps[q];renderScale.reset();qualityLabels.forEach(function(id,i){document.getElementById(id).classList.toggle('on',i===q);});};

// Dismiss the GPU-load gate and reveal the interface; on mobile the equations
// start collapsed. The map shows on all screens while its toggle is on.
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
  }
  if(mapOn){mmCanvas.style.display='block';sizeMap();}
};

// Set a button's on/off classes to match a boolean.
function setBtn(id,on){var el=document.getElementById(id);if(!el)return;el.classList.toggle('on',on);el.classList.toggle('off',!on);}
// Feature toggles: each flips a state flag the frame loop pushes to the shader.
window.toggleGeodesic=function(){useGeodesic=!useGeodesic;setBtn('btnGeodesic',useGeodesic);renderScale.reset();};
window.toggleRK4=function(){useRK4=!useRK4;setBtn('btnRK4',useRK4);renderScale.reset();};
window.toggleDisc=function(){showDisc=!showDisc;setBtn('btnDisc',showDisc);};
window.toggleGlow=function(){showGlow=!showGlow;setBtn('btnGlow',showGlow);};
window.setBg=function(m){bgMode=m;['bgStars','bgGrid','bgUV','bgNeb','bgRings'].forEach(function(id,i){var el=document.getElementById(id);if(el){el.classList.toggle('on',i===m);}});};
window.toggleEqPanel=function(){var p=document.getElementById('eqPanel'),b=document.getElementById('eqToggleBtn');p.classList.toggle('collapsed');b.textContent=p.classList.contains('collapsed')?'+':'−';};

// Auto-descent: fly the camera along the axis, bouncing between the two
// universes at the range limits. Start/stop toggles the play button.
var descending=false,descentDir=0,lastFrameTime=0,descentSpeed=4.0;
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
  var baseSpeed=descentSpeed;
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
// lib/render-scale.js also caps the pixel count and lowers it while the
// frame rate is low.
var renderScale=RenderScale.create({canvas:canvas,gl:gl,label:document.getElementById('res'),
  fracDesktop:0.4,fracMobile:0.25,mobileWidth:768});
window.addEventListener('resize',renderScale.resize);renderScale.resize();

// Map: the embedding diagram of the equatorial slice, drawn on canvas#minimap.
// The slice (l, phi) is embedded in flat 3D space as a surface of revolution.
// It has the areal radius r(l) as its radius and z(l) as its height, where
// dz/dl = sqrt(1 - r'(l)^2). Thus z = l in the flat throat, and outside it
// z = sign(l) (a + k asinh(x/k)) with x = |l| - a. Arc length along the
// profile is the proper distance l. r and z use one scale (no exaggeration),
// so the funnel shape is true. Sheet A (l > 0) is the upper sheet, sheet B
// (l < 0) the lower sheet, and they join at the throat ring (r = k).
// The metric is spherically symmetric, so the orbit angles do not change the
// physics. The camera dot is always on the right meridian at height z(camL).
// The arrow is the radial part of the view direction, along the profile:
// toward the throat when cos(alpha) > 0, where cos(alpha) = -fwd . rhat. The
// sideways part sin(alpha) points along the ring, out of the drawing, and
// shows as a circled dot. The shader uses the same split (initWRay).
var mmCanvas=document.getElementById('minimap'),mmCtx=mmCanvas.getContext('2d');
var mapOn=true,mmW=0,mmH=0,mmDpr=1,mmFont='',mmSerif='',mmColL='';
// Size the backing store from the CSS box (DPR aware); call when shown or resized.
function sizeMap(){var b=mmCanvas.getBoundingClientRect();if(!b.width)return;
  mmDpr=Math.min(window.devicePixelRatio||1,2);mmW=b.width;mmH=b.height;
  mmCanvas.width=Math.round(mmW*mmDpr);mmCanvas.height=Math.round(mmH*mmDpr);
  var cs=getComputedStyle(document.documentElement);
  mmFont=cs.getPropertyValue('--sci-mono').trim()||'monospace';mmSerif=cs.getPropertyValue('--sci-serif').trim()||'serif';mmColL=cs.getPropertyValue('--m1').trim()||'#7fd0ff';}
window.addEventListener('resize',sizeMap);
window.toggleMap=function(){mapOn=!mapOn;setBtn('btnMap',mapOn);
  mmCanvas.style.display=mapOn?'block':'none';if(mapOn)sizeMap();};
// Profile of the slice at signed l: areal radius r and embedding height z.
function mapProf(l){var k=throatK,a=throatA,al=Math.abs(l),x=Math.max(0,al-a);
  var z=al<=a?al:a+k*Math.asinh(x/k);return{r:Math.sqrt(k*k+x*x),z:l<0?-z:z};}
function drawMinimap(rad,fwd){
  if(!mapOn||!mmW||mmCanvas.style.display==='none')return;
  var c=mmCtx,W=mmW,H=mmH,small=W<220;
  c.setTransform(mmDpr,0,0,mmDpr,0,0);c.clearRect(0,0,W,H);
  // Drawn range of |l|: the descent range, or more when the camera is far out.
  var lMax=Math.max(20,Math.abs(camL)*1.1+1),pm=mapProf(lMax);
  // Orthographic view from 10 degrees above the slice plane. Depth y > 0 is
  // toward the viewer and goes down on the screen.
  var el=0.17,ce=Math.cos(el),se=Math.sin(el);
  var textH=small?16:20,plotH=H-textH,pad=6;
  var sc=Math.min((W/2-pad)/pm.r,(plotH/2-pad)/(pm.z*ce+pm.r*se));
  var ox=W/2,oy=plotH/2+2;
  function P(x,y,z){return[ox+x*sc,oy-(z*ce-y*se)*sc];}
  var warm='255,200,120',cool='120,180,255';
  // Rings of constant l on both sheets: back half faint, front half brighter.
  function ring(l,col,aBack,aFront,lw){var p=mapProf(l),cy=oy-p.z*ce*sc,rx=p.r*sc,ry=p.r*se*sc;
    c.lineWidth=lw;c.strokeStyle='rgba('+col+','+aBack+')';c.beginPath();c.ellipse(ox,cy,rx,ry,0,Math.PI,2*Math.PI);c.stroke();
    c.strokeStyle='rgba('+col+','+aFront+')';c.beginPath();c.ellipse(ox,cy,rx,ry,0,0,Math.PI);c.stroke();}
  for(var i=1;i<=4;i++){var lr=throatA+(lMax-throatA)*i/4;ring(lr,warm,0.12,0.3,1);ring(-lr,cool,0.12,0.3,1);}
  // The two meridians (left and right limbs) of each sheet.
  for(var s=-1;s<=1;s+=2){c.lineWidth=1.4;
    for(var side=-1;side<=1;side+=2){c.strokeStyle='rgba('+(side>0?warm:cool)+',0.75)';c.beginPath();
      for(var j=0;j<=60;j++){var l=side*lMax*j/60,p=mapProf(l),q=P(s*p.r,0,p.z);if(j)c.lineTo(q[0],q[1]);else c.moveTo(q[0],q[1]);}
      c.stroke();}}
  ring(0,'100,240,240',0.45,0.9,1.6);
  // Sheet labels at the outer left end of each sheet.
  c.font=(small?'600 10px ':'600 11px ')+mmFont;c.textBaseline='middle';c.textAlign='left';
  var qa=P(-pm.r,0,pm.z),qb=P(-pm.r,0,-pm.z);
  c.fillStyle='rgba('+warm+',0.85)';c.fillText('A',qa[0]+2,qa[1]-7);
  c.fillStyle='rgba('+cool+',0.85)';c.fillText('B',qb[0]+2,qb[1]+7);
  // Camera dot on the right meridian.
  var pc=mapProf(camL),dp=P(pc.r,0,pc.z),dotC=camL>=0?'#ffb850':'#64b4ff';
  // Unit tangent toward the throat, on the screen: finite step of l toward 0.
  var h=0.02,lt=Math.abs(camL)>h?camL-Math.sign(camL)*h:(camL>=0?-h:h);
  var pt=mapProf(lt),tp=P(pt.r,0,pt.z),tx=tp[0]-dp[0],ty=tp[1]-dp[1],tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
  var cosA=-(fwd[0]*rad[0]+fwd[1]*rad[1]+fwd[2]*rad[2]);cosA=Math.max(-1,Math.min(1,cosA));
  var sinA=Math.sqrt(1-cosA*cosA),AL=small?20:28;
  if(Math.abs(cosA)>0.08){var ex=dp[0]+tx*AL*cosA,ey=dp[1]+ty*AL*cosA,ux=tx*Math.sign(cosA),uy=ty*Math.sign(cosA);
    c.strokeStyle='#fff';c.fillStyle='#fff';c.lineWidth=1.6;c.beginPath();c.moveTo(dp[0],dp[1]);c.lineTo(ex,ey);c.stroke();
    c.beginPath();c.moveTo(ex+ux*2,ey+uy*2);c.lineTo(ex-ux*5-uy*3.5,ey-uy*5+ux*3.5);c.lineTo(ex-ux*5+uy*3.5,ey-uy*5-ux*3.5);c.closePath();c.fill();}
  if(sinA>0.15){var gx=dp[0]+9,gy=dp[1]-9;c.globalAlpha=Math.min(1,sinA);c.strokeStyle='#fff';c.fillStyle='#fff';c.lineWidth=1;
    c.beginPath();c.arc(gx,gy,3.5,0,2*Math.PI);c.stroke();c.beginPath();c.arc(gx,gy,1,0,2*Math.PI);c.fill();c.globalAlpha=1;}
  c.fillStyle=dotC;c.shadowColor=dotC;c.shadowBlur=8;c.beginPath();c.arc(dp[0],dp[1],small?3.5:4.5,0,2*Math.PI);c.fill();c.shadowBlur=0;
  // Readout: proper distance, universe, and the view angle off the throat.
  var ty0=H-textH/2-1,ang=Math.round(Math.acos(cosA)*180/Math.PI);
  c.font=(small?'10px ':'11px ')+mmFont;c.textAlign='left';
  // The ell glyph is small in monospace fonts, so it is set in the serif.
  c.fillStyle=mmColL;c.font=(small?'italic 13px ':'italic 14px ')+mmSerif;c.fillText('ℓ',6,ty0);
  var x1=6+c.measureText('ℓ ').width;c.font=(small?'10px ':'11px ')+mmFont;
  var s1=(camL<0?'−':'')+Math.abs(camL).toFixed(1);c.fillText(s1,x1,ty0);x1+=c.measureText(s1+'  ').width;
  c.fillStyle=dotC;var s2=camL>=0?'A':'B';c.fillText(s2,x1,ty0);x1+=c.measureText(s2+'  ').width;
  c.fillStyle='rgba(255,255,255,0.6)';c.fillText((small?'':'view ')+ang+'° off throat',x1,ty0);
}

// The per-frame loop: apply idle spin and descent, build the camera basis from
// orbit and look angles, derive adaptive step counts from distance, push all
// uniforms, draw the fullscreen quad, and refresh the map.
var frames=0,lastT=performance.now();
function frame(){
  var now=performance.now();frames++;renderScale.tick(now);
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

  // Scale the integration step and escape radius with distance. The shader
  // puts a floor under the step (STEP_GROW, STEP_THROAT), so a ray needs
  // about 150 to 300 steps at any camera range. The budget only stops rays
  // that wind round the throat. It no longer grows as the camera comes
  // closer: the old divide by scaleR gave 4096 steps at camL = 8.
  var scaleR=absL/20.0;var dl=baseDl*scaleR;
  var distFactor=Math.min(1.0,Math.abs(camL)/(throatK*5.0));
  var dynSteps=Math.round(maxSteps*(0.35+0.65*distFactor));
  var steps=Math.max(256,Math.round(dynSteps/Math.max(scaleR,1.0)));
  var escR=escMul*Math.max(scaleR,1.0);
  var universe=camL>=0?'Universe A':'Universe B';
  document.getElementById('mode').textContent=(useGeodesic?(useRK4?'RK4':'Euler'):'Straight')+' · '+universe;
  document.getElementById('hudSub').textContent='Ellis metric · '+universe;
  if(saverLabel&&universe!==saverUniverse){saverUniverse=universe;showSaverLabel();}

  // Push all camera and wormhole state into the shader, then draw one quad.
  // shaderL is nudged off exactly zero so the sign (universe) is well defined.
  var shaderL=camL;if(Math.abs(shaderL)<0.1)shaderL=shaderL>=0?0.1:-0.1;
  gl.uniform2f(U.u_res,canvas.width,canvas.height);
  gl.uniform3f(U.u_camPos,cx,cy,cz);
  gl.uniform3f(U.u_camFwd,fwd[0],fwd[1],fwd[2]);gl.uniform3f(U.u_camRight,right[0],right[1],right[2]);gl.uniform3f(U.u_camUp,up[0],up[1],up[2]);
  gl.uniform1f(U.u_focalLen,FOCAL_PER_H*canvas.height);gl.uniform1f(U.u_throatK,throatK);gl.uniform1f(U.u_throatA,throatA);
  gl.uniform1f(U.u_discInner,throatK*1.05);gl.uniform1f(U.u_discOuter,throatK*4.0);
  gl.uniform1f(U.u_dl,dl);gl.uniform1f(U.u_maxSteps,steps);gl.uniform1f(U.u_escapeR,escR);
  gl.uniform1f(U.u_useGeodesic,useGeodesic?1:0);gl.uniform1f(U.u_useRK4,useRK4?1:0);
  gl.uniform1f(U.u_showDisc,showDisc?1:0);gl.uniform1f(U.u_showGlow,showGlow?1:0);
  gl.uniform1f(U.u_bgMode,bgMode);gl.uniform1f(U.u_camL,shaderL);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  drawMinimap([cx/fl,cy/fl,cz/fl],fwd);
  requestAnimationFrame(frame);
}
// Inside the site shell iframe, mark the body so CSS can hide page chrome.
if(window.self!==window.top)document.body.classList.add('in-frame');
frame();

// The [data-tex] boxes in index.html hold the three equations. lib/sci-math.js
// typesets them as MathJax SVG. Each quantity has one math color class
// (lib/sci.css), the same on the control that sets it:
//   \ell proper distance -> m1 (traverse bar value), r areal radius -> m2,
//   k throat radius -> m3 (K slider), a flat half-width -> m4 (L slider),
//   g_{\mu\nu} metric -> m5, T^{\mu}{}_{\nu} stress-energy -> m6.
var EQ_RULES=[['\\ell','m1'],['r','m2'],['k','m3'],['a','m4'],['g_{\\mu\\nu}','m5'],['T^{\\mu}{}_{\\nu}','m6']];
function renderEqs(){
  import(new URL('../../lib/sci-math.js',document.baseURI).href).then(function(m){
    m.typesetAll(document.getElementById('eqPanel'),EQ_RULES);
    document.querySelectorAll('[data-sym]').forEach(function(el){m.typeset(el,el.dataset.sym,{display:false,rules:EQ_RULES});});
  });
}
renderEqs();

// Screensaver hook for the shell (lib/screensaver.js). It hides every element
// but canvas#c (the GPU gate stays closed, so dismissWarn never runs), sizes
// the canvas at full window resolution under the same pixel budget and fps
// control, and starts the descent. opts.calm (1 = slowest) halves the spin
// and descent speeds at most; opts.seed picks the stars or the nebula sky.
// No exit(): the shell reloads the page on stop.
// The label plate names the universe the camera is in. frame() calls it
// again when the descent crosses the throat.
var saverLabel=null,saverUniverse='';
// The plate holds live parameters, the page's TeX (index.html eq2, eq3)
// and its EQ_RULES (ell m1, r m2, k m3, a m4, g m5, T m6). eq is the plain
// fallback. enter() also calls it each second, so the camera values move.
function showSaverLabel(){
  var rl=Math.sqrt(throatK*throatK+Math.pow(Math.max(0,Math.abs(camL)-throatA),2));
  saverLabel({title:'Ellis wormhole',sub:'Null geodesics, traversable throat, '+saverUniverse,
    params:[{sym:'\\ell',name:'camera',value:camL.toFixed(1).replace('-','−')},
      {sym:'r(\\ell)',name:'areal radius',value:rl.toFixed(2),cls:'m2'},
      {sym:'k',name:'throat radius',value:throatK.toFixed(1),cls:'m3'},
      {sym:'a',name:'flat half-width',value:throatA.toFixed(1),cls:'m4'}],
    tex:['ds^2 = -dt^2 + d\\ell^2 + r(\\ell)^2\\,d\\Omega^2',
      'r(\\ell) = \\sqrt{k^{2} + \\bigl[\\max(0,\\;|\\ell| - a)\\bigr]^{2}}',
      'T^{\\mu}{}_{\\nu} = \\frac{k^{2}}{8\\pi\\,r^{4}}\\,\\mathrm{diag}(-1,\\,+1,\\,0,\\,0)'],
    rules:EQ_RULES,
    eq:['ds² = −dt² + dℓ² + r(ℓ)² dΩ²','r(ℓ) = √(k² + max(0, |ℓ| − a)²)'],
    anchor:throatAnchor});
}
// The throat on screen. The camera looks at the centre (the saver damps the
// look angles to 0), and the image plane is FOCAL_PER_H x height away. Rays
// with impact parameter below k pass the throat, so its image has angular
// radius asin(k / r(ell)). Close to the throat the image fills the window:
// then return null (full field, the plate goes to the corner).
function throatAnchor(){
  var b=canvas.getBoundingClientRect(),f=FOCAL_PER_H*b.height;
  var rl=Math.sqrt(throatK*throatK+Math.pow(Math.max(0,Math.abs(camL)-throatA),2));
  var s=throatK/rl;if(s>=0.98)return null;
  var R=f*s/Math.sqrt(1-s*s);if(R>0.45*Math.min(b.width,b.height))return null;
  var cx=b.left+b.width/2,cy=b.top+b.height/2;
  return {x:cx,y:cy,r:1.2*R,pts:[{x:cx,y:cy}]};
}
window.snSaver={enter:function(o){
  var calm=Math.max(0,Math.min(1,o&&o.calm!=null?o.calm:0.7));
  if(o&&typeof o.label==='function'){saverLabel=o.label;setInterval(function(){if(saverUniverse)showSaverLabel();},1000);}
  var st=document.createElement('style');
  st.textContent='body>*:not(#c){display:none!important}canvas#c{cursor:none!important}';
  document.head.appendChild(st);
  mapOn=false;   // the style above hides canvas#minimap; do not draw it
  renderScale=RenderScale.create({canvas:canvas,gl:gl,fracDesktop:1,fracMobile:0.5,mobileWidth:768});
  window.addEventListener('resize',renderScale.resize);renderScale.resize();
  setBg(((o&&o.seed)|0)%2?3:0);
  SPIN_SPEED=0.0008*(1-0.5*calm);descentSpeed=4.0*(1-0.5*calm);
  if(!descending)toggleDescend();
  return {canvas:canvas,warmupMs:2000};
}};
})();
