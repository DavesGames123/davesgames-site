(async () => {
const VS = await (await fetch(new URL('shaders/raytracer.vert.glsl', document.baseURI))).text();

const FS = await (await fetch(new URL('shaders/raytracer.frag.glsl', document.baseURI))).text();


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
['u_res','u_camPos','u_camFwd','u_camRight','u_camUp','u_focalLen','u_rs','u_discInner','u_discOuter',
 'u_geodesicDl','u_maxSteps','u_escapeR','u_useGeodesic','u_useRK4','u_showDisc','u_bgMode'
].forEach(n=>U[n]=gl.getUniformLocation(prog,n));

const CC=2.99792458e8,GR=6.67430e-11,RS=2.0*GR*4.3e6*1.989e30/(CC*CC);
let camYaw=0,camPitch=0.15,camRadius=32*RS;
const FOCAL=700;
let useGeodesic=true,useRK4=false,showDisc=true;
let bgMode=0;
let geodesicDl=5e7*1.9*4.0,maxSteps=2048,escMul=35;
let autoSpin=true;
const SPIN_SPEED=0.0008;
let warnDismissed=false;
var spinTimer=null;
var spinEnabled=true;
const SPIN_RESUME_MS=4000;
function pauseSpin(){
  autoSpin=false;
  if(spinTimer)clearTimeout(spinTimer);
  if(spinEnabled){
    spinTimer=setTimeout(function(){autoSpin=true;},SPIN_RESUME_MS);
  }
  document.getElementById('hint').style.opacity='0';
}
window.toggleSpin=function(){
  spinEnabled=!spinEnabled;
  var el=document.getElementById('btnSpin');
  el.classList.toggle('on',spinEnabled);
  el.classList.toggle('off',!spinEnabled);
  if(spinEnabled){autoSpin=true;}
  else{autoSpin=false;if(spinTimer){clearTimeout(spinTimer);spinTimer=null;}}
};
var qualitySteps=[512,2048,4096];
var qualityLabels=['btnQLow','btnQMed','btnQHigh'];
var currentQuality=1;
window.setQuality=function(q){
  currentQuality=q;maxSteps=qualitySteps[q];
  qualityLabels.forEach(function(id,i){
    var el=document.getElementById(id);
    el.classList.toggle('on',i===q);el.classList.toggle('off',false);
  });
};

window.dismissWarn=function(){
  document.getElementById('gpuWarn').classList.add('hide');
  document.getElementById('ctrlWrap').style.display='flex';
  document.getElementById('bgBar').style.display='flex';
  document.getElementById('eqPanel').style.display='flex';
  warnDismissed=true;
};

let dragging=false,lmx=0,lmy=0;

canvas.addEventListener('mousedown',function(e){dragging=true;lmx=e.clientX;lmy=e.clientY;pauseSpin();});
window.addEventListener('mouseup',function(){dragging=false;});
window.addEventListener('mousemove',function(e){if(!dragging)return;
  camYaw-=(e.clientX-lmx)*0.005;camPitch-=(e.clientY-lmy)*0.005;
  camPitch=Math.max(-Math.PI*0.49,Math.min(Math.PI*0.49,camPitch));
  lmx=e.clientX;lmy=e.clientY;});

canvas.addEventListener('touchstart',function(e){
  e.preventDefault();pauseSpin();
  if(e.touches.length===1){dragging=true;lmx=e.touches[0].clientX;lmy=e.touches[0].clientY;}
  if(e.touches.length===2){dragging=false;pinchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}
},{passive:false});
var pinchDist=0;
canvas.addEventListener('touchmove',function(e){
  e.preventDefault();
  if(e.touches.length===1&&dragging){
    var t=e.touches[0];
    camYaw-=(t.clientX-lmx)*0.005;camPitch-=(t.clientY-lmy)*0.005;
    camPitch=Math.max(-Math.PI*0.49,Math.min(Math.PI*0.49,camPitch));
    lmx=t.clientX;lmy=t.clientY;
  }
  if(e.touches.length===2){
    var nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    var ratio=pinchDist/nd;
    camRadius*=ratio;camRadius=Math.max(RS*5,Math.min(RS*200,camRadius));
    document.getElementById('zoomSlider').value=Math.round(camRadius/RS);
    document.getElementById('zoomVal').textContent=Math.round(camRadius/RS);
    pinchDist=nd;
  }
},{passive:false});
canvas.addEventListener('touchend',function(){dragging=false;});

canvas.addEventListener('wheel',function(e){e.preventDefault();pauseSpin();
  camRadius*=e.deltaY>0?1.08:0.92;camRadius=Math.max(RS*5,Math.min(RS*200,camRadius));
  document.getElementById('zoomSlider').value=Math.round(camRadius/RS);
  document.getElementById('zoomVal').textContent=Math.round(camRadius/RS);},{passive:false});

window.addEventListener('keydown',function(e){var s=0.05;pauseSpin();
  if(e.key==='ArrowLeft')camYaw+=s;if(e.key==='ArrowRight')camYaw-=s;
  if(e.key==='ArrowUp')camPitch=Math.min(camPitch+s,Math.PI*0.49);
  if(e.key==='ArrowDown')camPitch=Math.max(camPitch-s,-Math.PI*0.49);});

document.getElementById('zoomSlider').addEventListener('input',function(){
  camRadius=this.value*RS;document.getElementById('zoomVal').textContent=this.value;});

function setBtn(id,on){var el=document.getElementById(id);el.classList.toggle('on',on);el.classList.toggle('off',!on);}
window.toggleGeodesic=function(){useGeodesic=!useGeodesic;setBtn('btnGeodesic',useGeodesic);};
window.toggleRK4=function(){useRK4=!useRK4;setBtn('btnRK4',useRK4);};
window.toggleDisc=function(){showDisc=!showDisc;setBtn('btnDisc',showDisc);};
window.setBg=function(m){
  bgMode=m;
  document.getElementById('bgStars').classList.toggle('active',m===0);
  document.getElementById('bgGrid').classList.toggle('active',m===1);
  document.getElementById('bgUV').classList.toggle('active',m===2);
  document.getElementById('bgNebula').classList.toggle('active',m===3);
  document.getElementById('bgRings').classList.toggle('active',m===4);
};
window.toggleEqPanel=function(){
  var panel=document.getElementById('eqPanel');
  var btn=document.getElementById('eqToggleBtn');
  panel.classList.toggle('collapsed');
  btn.textContent=panel.classList.contains('collapsed')?'+':'−';
};

function resize(){
  var dpr=Math.min(window.devicePixelRatio||1,2);
  var isMobile=window.innerWidth<600;
  var scale=isMobile?0.25:0.4;
  canvas.width=Math.floor(window.innerWidth*dpr*scale);
  canvas.height=Math.floor(window.innerHeight*dpr*scale);
  gl.viewport(0,0,canvas.width,canvas.height);
  document.getElementById('res').textContent=canvas.width+'×'+canvas.height;
}
window.addEventListener('resize',resize);resize();

var frames=0,lastT=performance.now();
function frame(){
  var now=performance.now();frames++;
  if(now-lastT>500){document.getElementById('fps').textContent=Math.round(frames/((now-lastT)/1000))+' fps';frames=0;lastT=now;}

  if(autoSpin) camYaw-=SPIN_SPEED;

  var cx=camRadius*Math.cos(camPitch)*Math.cos(camYaw),cy=camRadius*Math.sin(camPitch),cz=camRadius*Math.cos(camPitch)*Math.sin(camYaw);
  var fl=Math.sqrt(cx*cx+cy*cy+cz*cz),fwd=[-cx/fl,-cy/fl,-cz/fl];
  var rl=Math.sqrt(fwd[2]*fwd[2]+fwd[0]*fwd[0]);
  var right=rl>1e-6?[fwd[2]/rl,0,-fwd[0]/rl]:[1,0,0];
  var up=[fwd[1]*right[2]-fwd[2]*right[1],fwd[2]*right[0]-fwd[0]*right[2],fwd[0]*right[1]-fwd[1]*right[0]];
  var scaleR=camRadius/(32*RS),dl=geodesicDl*scaleR,steps=Math.max(1,Math.round(maxSteps*scaleR)),escR=escMul*scaleR;
  document.getElementById('mode').textContent=useGeodesic?(useRK4?'Geodesic (RK4)':'Geodesic (Euler)'):'Straight rays';

  gl.uniform2f(U.u_res,canvas.width,canvas.height);
  gl.uniform3f(U.u_camPos,cx,cy,cz);gl.uniform3f(U.u_camFwd,fwd[0],fwd[1],fwd[2]);
  gl.uniform3f(U.u_camRight,right[0],right[1],right[2]);gl.uniform3f(U.u_camUp,up[0],up[1],up[2]);
  gl.uniform1f(U.u_focalLen,FOCAL);gl.uniform1f(U.u_rs,RS);
  gl.uniform1f(U.u_discInner,3.0*RS);gl.uniform1f(U.u_discOuter,5.1*RS);
  gl.uniform1f(U.u_geodesicDl,dl);gl.uniform1f(U.u_maxSteps,steps);gl.uniform1f(U.u_escapeR,escR);
  gl.uniform1f(U.u_useGeodesic,useGeodesic?1:0);gl.uniform1f(U.u_useRK4,useRK4?1:0);
  gl.uniform1f(U.u_showDisc,showDisc?1:0);gl.uniform1f(U.u_bgMode,bgMode);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  requestAnimationFrame(frame);
}

if(window.self!==window.top)document.body.classList.add('in-frame');
frame();

// ─── KaTeX equations ───
// Colors: R (curvature) amber, g (metric) blue, T (stress-energy) pink, G lavender, c cyan
function renderEqs(){
  if(typeof katex==='undefined'){setTimeout(renderEqs,100);return;}
  var R_C='#ffb464', G_C='#96c8ff', T_C='#e8a0c8', GR_C='#c8a8e8', C_C='#7ce0d0';

  // Schwarzschild metric tensor — 4×4 matrix form
  katex.render(
    '\\textcolor{'+G_C+'}{g_{\\mu\\nu}} = \\begin{pmatrix}'
    + '-\\!\\left(1 - \\tfrac{\\textcolor{'+R_C+'}{r_s}}{\\textcolor{'+G_C+'}{r}}\\right)\\!\\textcolor{'+C_C+'}{c}^2 & 0 & 0 & 0 \\\\'
    + '0 & \\left(1 - \\tfrac{\\textcolor{'+R_C+'}{r_s}}{\\textcolor{'+G_C+'}{r}}\\right)^{\\!-1} & 0 & 0 \\\\'
    + '0 & 0 & \\textcolor{'+G_C+'}{r}^2 & 0 \\\\'
    + '0 & 0 & 0 & \\textcolor{'+G_C+'}{r}^2 \\sin^2\\theta'
    + '\\end{pmatrix}',
    document.getElementById('eq1'),{throwOnError:false}
  );

  // Einstein field equations — full tensor equation
  katex.render(
    '\\textcolor{'+R_C+'}{R_{\\mu\\nu}} - \\tfrac{1}{2}\\textcolor{'+G_C+'}{g_{\\mu\\nu}}\\textcolor{'+R_C+'}{R} = \\frac{8\\pi \\textcolor{'+GR_C+'}{G}}{\\textcolor{'+C_C+'}{c}^4}\\textcolor{'+T_C+'}{T_{\\mu\\nu}}',
    document.getElementById('eq2'),{throwOnError:false}
  );
}
renderEqs();
})();
