(async () => {
const VS = await (await fetch(new URL('shaders/wormhole.vert.glsl', document.baseURI))).text();
const FS = await (await fetch(new URL('shaders/wormhole.frag.glsl', document.baseURI))).text();

const canvas=document.getElementById('c');
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});
if(!gl){document.body.innerHTML='<h1 style="color:red;padding:2em">WebGL 2 required</h1>';throw '';}
function compile(src,type){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}return s;}
const vs=compile(VS,gl.VERTEX_SHADER),fs=compile(FS,gl.FRAGMENT_SHADER);
const prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);
gl.bindAttribLocation(prog,0,'a_pos');gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS))console.error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
const U={};
['u_res','u_camPos','u_camFwd','u_camRight','u_camUp','u_focalLen',
 'u_throatK','u_throatA','u_discInner','u_discOuter',
 'u_dl','u_maxSteps','u_escapeR','u_useGeodesic','u_useRK4','u_showDisc','u_showGlow','u_bgMode','u_camL'
].forEach(n=>U[n]=gl.getUniformLocation(prog,n));

let throatK=1.5,throatA=0.5;
let orbYaw=0,orbPitch=0.15;
let lookYaw=0,lookPitch=0;
let camL=20;
const FOCAL=700;
let useGeodesic=true,useRK4=false,showDisc=false,showGlow=true,bgMode=0;
let baseDl=0.12,maxSteps=2048,escMul=50;
let autoSpin=true,spinEnabled=true;
const SPIN_SPEED=0.0008;
var spinTimer=null;
const SPIN_RESUME_MS=4000;

function pauseSpin(){autoSpin=false;if(descending){descending=false;var pb=document.getElementById('playBtn');if(pb){pb.classList.remove('on');pb.textContent='\u25B6';}}if(spinTimer)clearTimeout(spinTimer);
  if(spinEnabled)spinTimer=setTimeout(function(){autoSpin=true;},SPIN_RESUME_MS);
  document.getElementById('hint').style.opacity='0';}

window.toggleSpin=function(){spinEnabled=!spinEnabled;setBtn('btnSpin',spinEnabled);
  if(spinEnabled)autoSpin=true;else{autoSpin=false;if(spinTimer){clearTimeout(spinTimer);spinTimer=null;}}};
var qualitySteps=[512,2048,4096],qualityLabels=['btnQLow','btnQMed','btnQHigh'];
window.setQuality=function(q){maxSteps=qualitySteps[q];qualityLabels.forEach(function(id,i){document.getElementById(id).classList.toggle('on',i===q);});};

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

function setBtn(id,on){var el=document.getElementById(id);if(!el)return;el.classList.toggle('on',on);el.classList.toggle('off',!on);}
window.toggleGeodesic=function(){useGeodesic=!useGeodesic;setBtn('btnGeodesic',useGeodesic);};
window.toggleRK4=function(){useRK4=!useRK4;setBtn('btnRK4',useRK4);};
window.toggleDisc=function(){showDisc=!showDisc;setBtn('btnDisc',showDisc);};
window.toggleGlow=function(){showGlow=!showGlow;setBtn('btnGlow',showGlow);};
window.setBg=function(m){bgMode=m;['bgStars','bgGrid','bgUV','bgNeb','bgRings'].forEach(function(id,i){var el=document.getElementById(id);if(el){el.classList.toggle('on',i===m);}});};
window.toggleEqPanel=function(){var p=document.getElementById('eqPanel'),b=document.getElementById('eqToggleBtn');p.classList.toggle('collapsed');b.textContent=p.classList.contains('collapsed')?'+':'−';};

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
function syncSlider(){document.getElementById('zoomSlider').value=camL.toFixed(1);document.getElementById('zoomVal').textContent=camL.toFixed(1);}

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

canvas.addEventListener('wheel',function(e){e.preventDefault();pauseSpin();
  var speed=Math.max(Math.abs(camL)*0.06,0.3);camL-=e.deltaY>0?speed:-speed;
  camL=Math.max(-60,Math.min(60,camL));syncSlider();},{passive:false});

window.addEventListener('keydown',function(e){pauseSpin();var s=0.05;
  if(e.key==='ArrowLeft')orbYaw+=s;if(e.key==='ArrowRight')orbYaw-=s;
  if(e.key==='ArrowUp'){orbPitch=Math.min(orbPitch+s,1.5);}
  if(e.key==='ArrowDown'){orbPitch=Math.max(orbPitch-s,-1.5);}
  if(e.key==='w'||e.key==='W'){camL-=Math.max(Math.abs(camL)*0.04,0.2);camL=Math.max(-60,Math.min(60,camL));syncSlider();}
  if(e.key==='s'||e.key==='S'){camL+=Math.max(Math.abs(camL)*0.04,0.2);camL=Math.max(-60,Math.min(60,camL));syncSlider();}
  if(e.key==='r'||e.key==='R'){lookYaw=0;lookPitch=0;}
});

document.getElementById('zoomSlider').addEventListener('input',function(){camL=+this.value;document.getElementById('zoomVal').textContent=camL.toFixed(1);});
document.getElementById('throatSlider').addEventListener('input',function(){throatK=+this.value;document.getElementById('throatVal').textContent=(+this.value).toFixed(1);});
document.getElementById('lengthSlider').addEventListener('input',function(){throatA=+this.value;document.getElementById('lengthVal').textContent=(+this.value).toFixed(1);});

function resize(){var dpr=Math.min(window.devicePixelRatio||1,2),mob=window.innerWidth<768,sc=mob?0.25:0.4;
  canvas.width=Math.floor(window.innerWidth*dpr*sc);canvas.height=Math.floor(window.innerHeight*dpr*sc);
  gl.viewport(0,0,canvas.width,canvas.height);document.getElementById('res').textContent=canvas.width+'×'+canvas.height;}
window.addEventListener('resize',resize);resize();

var mmCanvas=document.getElementById('minimap'),mmCtx=mmCanvas.getContext('2d');
function drawMinimap(){
  if(window.innerWidth<768)return; // skip on mobile
  var W=mmCanvas.width,H=mmCanvas.height;
  mmCtx.clearRect(0,0,W,H);
  var k=throatK,a=throatA;
  var NL=50,lMax=20,prof=[];
  for(var i=0;i<=NL;i++){var l=-lMax+i*2*lMax/NL;
    var x=Math.max(0,Math.abs(l)-a),r=Math.sqrt(k*k+x*x);
    var z=Math.abs(l)<=a?l:Math.sign(l)*(a+k*Math.asinh(x/k));
    prof.push({r:r,z:z,l:l});}
  var NPHI=28,surf=[];
  for(var i=0;i<prof.length;i++){var row=[];
    for(var j=0;j<=NPHI;j++){var phi=j*2*Math.PI/NPHI;
      row.push({x:prof[i].r*Math.cos(phi),y:prof[i].r*Math.sin(phi),z:prof[i].z});}
    surf.push(row);}
  var maxE=0;for(var i=0;i<prof.length;i++){maxE=Math.max(maxE,prof[i].r,Math.abs(prof[i].z));}
  var scX=W*0.72/Math.max(maxE,1),scZ=H*0.30/Math.max(maxE,1);var sc=Math.min(scX,scZ);
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
  var cx2=Math.max(0,Math.abs(camL)-a),cR=Math.sqrt(k*k+cx2*cx2);
  var cZ=Math.abs(camL)<=a?camL:Math.sign(camL)*(a+k*Math.asinh(cx2/k));
  var cPhi=orbYaw,cam3={x:cR*Math.cos(cPhi),y:cR*Math.sin(cPhi),z:cZ};
  var cp=proj(cam3),dotC=camL>=0?'#ffb850':'#64b4ff';
  mmCtx.fillStyle=dotC;mmCtx.shadowColor=dotC;mmCtx.shadowBlur=10;
  mmCtx.beginPath();mmCtx.arc(cp.x,cp.y,4.5,0,Math.PI*2);mmCtx.fill();mmCtx.shadowBlur=0;
}

var frames=0,lastT=performance.now();
function frame(){
  var now=performance.now();frames++;
  if(now-lastT>500){document.getElementById('fps').textContent=Math.round(frames/((now-lastT)/1000))+' fps';frames=0;lastT=now;}
  if(autoSpin)orbYaw-=SPIN_SPEED;
  updateDescent();
  if(autoSpin&&!dragging){lookYaw*=0.97;lookPitch*=0.97;if(Math.abs(lookYaw)<0.001)lookYaw=0;if(Math.abs(lookPitch)<0.001)lookPitch=0;}

  var absL=Math.max(Math.abs(camL),0.1);
  var cx=absL*Math.cos(orbPitch)*Math.cos(orbYaw),cy=absL*Math.sin(orbPitch),cz=absL*Math.cos(orbPitch)*Math.sin(orbYaw);
  var fl=Math.sqrt(cx*cx+cy*cy+cz*cz);
  var fwd=[-cx/fl,-cy/fl,-cz/fl];
  var rl=Math.sqrt(fwd[2]*fwd[2]+fwd[0]*fwd[0]);
  var right=rl>1e-6?[fwd[2]/rl,0,-fwd[0]/rl]:[1,0,0];
  var up=[fwd[1]*right[2]-fwd[2]*right[1],fwd[2]*right[0]-fwd[0]*right[2],fwd[0]*right[1]-fwd[1]*right[0]];

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

  var scaleR=absL/20.0;var dl=baseDl*scaleR;
  var distFactor=Math.min(1.0,Math.abs(camL)/(throatK*5.0));
  var dynSteps=Math.round(maxSteps*(0.35+0.65*distFactor));
  var steps=Math.max(128,Math.round(dynSteps/Math.max(scaleR,0.5)));
  var escR=escMul*Math.max(scaleR,1.0);
  var universe=camL>=0?'Universe A':'Universe B';
  document.getElementById('mode').textContent=(useGeodesic?(useRK4?'RK4':'Euler'):'Straight')+' · '+universe;
  document.getElementById('hudSub').textContent='Ellis Metric · '+universe;

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
if(window.self!==window.top)document.body.classList.add('in-frame');
frame();

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
