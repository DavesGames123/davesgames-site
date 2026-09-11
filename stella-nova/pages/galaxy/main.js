(async () => {
const CORE_VS = await (await fetch(new URL('shaders/core.vert.glsl', document.baseURI))).text();
const CORE_FS = await (await fetch(new URL('shaders/core.frag.glsl', document.baseURI))).text();
const STAR_VS = await (await fetch(new URL('shaders/star.vert.glsl', document.baseURI))).text();
const STAR_FS = await (await fetch(new URL('shaders/star.frag.glsl', document.baseURI))).text();

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, powerPreference:'high-performance' });
if (!gl) { document.body.innerHTML='<h1 style="color:red;padding:2em">WebGL 2 required</h1>'; throw ''; }

function makeProgram(vsSrc, fsSrc) {
  function compile(src,type) { const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  const p=gl.createProgram(); gl.attachShader(p,compile(vsSrc,gl.VERTEX_SHADER)); gl.attachShader(p,compile(fsSrc,gl.FRAGMENT_SHADER)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); return p;
}

const coreProg=makeProgram(CORE_VS,CORE_FS), starProg=makeProgram(STAR_VS,STAR_FS);

const quadBuf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);

const coreU={}; ['u_res','u_mouse','u_zoom','u_tilt'].forEach(n=>coreU[n]=gl.getUniformLocation(coreProg,n));
const coreAttrPos=gl.getAttribLocation(coreProg,'a_pos');

const starU={}; ['u_time','u_timescale','u_res','u_mouse','u_zoom','u_tilt','u_spiral'].forEach(n=>starU[n]=gl.getUniformLocation(starProg,n));
const ATTRS=['a_radius','a_speed','a_phase','a_ecc','a_radScatter','a_spiralOff','a_specHash','a_briHash','a_incl','a_node'];
const starAttr={}; ATTRS.forEach(n=>starAttr[n]=gl.getAttribLocation(starProg,n));

function hash(n){return((Math.sin(n)*43758.5453123)%1+1)%1}
function gaussRand(s1,s2){const u1=Math.max(hash(s1),0.0001),u2=hash(s2);return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2)}

let starVAO=null, starBuf=null, starCount=0;

function generateStars(count,numArms){
  const STRIDE=10, data=new Float32Array(count*STRIDE);
  const TAU=Math.PI*2, PI=Math.PI;
  const bulgeCount=Math.floor(count*0.25);

  for(let i=0;i<count;i++){
    const seed=i*7.31+0.5;
    const h0=hash(seed),h1=hash(seed+41),h2=hash(seed+73),h3=hash(seed+109);
    const h4=hash(seed+157),h5=hash(seed+199),h6=hash(seed+241),h7=hash(seed+283);
    const h8=hash(seed+317),h9=hash(seed+359);

    let radius,speed,phase,ecc,radScatter,spiralOff,specHash,briHash,incl,node;

    if(i<bulgeCount){
      // ── BULGE: larger radius range, old red/orange population ──
      const rNorm=-0.7*Math.log(1.0-h0*0.97);
      radius=6+rNorm*65;  // bigger bulge
      speed=(0.3+h1*0.7)/Math.pow(radius/6,0.8);
      phase=h2*TAU;
      ecc=h3*0.55;
      radScatter=0.5+h4*1.0;
      spiralOff=0.0;
      specHash=h5*0.50; // very red: max t = 0.5^4 = 0.0625 → deep M-class
      briHash=h7;
      incl=(0.3+Math.abs(gaussRand(seed+401,seed+433))*0.35)*PI*0.5;
      incl=Math.min(incl,PI*0.48);
      if(h8<0.5) incl=-incl;
      node=h9*TAU;
    } else {
      const rNorm=-1.2*Math.log(1.0-h0*0.985);
      radius=18+rNorm*85;
      speed=1.0/Math.pow(radius/18,1.15);
      const armIdx=Math.floor(h6*numArms);
      phase=(armIdx/numArms)*TAU+gaussRand(seed+331,seed+367)*(0.45+rNorm*0.25);
      spiralOff=rNorm*1.0+(h5-0.5)*0.5;
      ecc=h2*0.35;
      radScatter=0.55+h3*0.9;
      specHash=Math.min(h4+Math.min(rNorm*0.04,0.12),1.0);
      briHash=h7;
      incl=gaussRand(seed+401,seed+433)*(0.02+0.04/(1.0+rNorm*0.5))*PI*0.5;
      node=h9*TAU;
    }

    const off=i*STRIDE;
    data[off]=radius;data[off+1]=speed;data[off+2]=phase;data[off+3]=ecc;
    data[off+4]=radScatter;data[off+5]=spiralOff;data[off+6]=specHash;
    data[off+7]=briHash;data[off+8]=incl;data[off+9]=node;
  }

  if(!starBuf) starBuf=gl.createBuffer();
  if(!starVAO) starVAO=gl.createVertexArray();
  gl.bindVertexArray(starVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER,starBuf);
  gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
  const BYTES=STRIDE*4;
  ATTRS.forEach((name,idx)=>{const loc=starAttr[name];if(loc<0)return;gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,1,gl.FLOAT,false,BYTES,idx*4);});
  gl.bindVertexArray(null);
  starCount=count;
  document.getElementById('starcount').textContent=count.toLocaleString()+' stars';
}

let dragX=0,dragY=0,dragging=false,lmx=0,lmy=0;
canvas.addEventListener('mousedown',e=>{dragging=true;lmx=e.clientX;lmy=e.clientY});
window.addEventListener('mouseup',()=>dragging=false);
window.addEventListener('mousemove',e=>{if(!dragging)return;dragX+=(e.clientX-lmx)*0.006;dragY+=(e.clientY-lmy)*0.006;lmx=e.clientX;lmy=e.clientY;document.getElementById('hint').style.opacity='0'});
canvas.addEventListener('touchstart',e=>{dragging=true;const t=e.touches[0];lmx=t.clientX;lmy=t.clientY},{passive:true});
window.addEventListener('touchend',()=>dragging=false);
window.addEventListener('touchmove',e=>{if(!dragging)return;const t=e.touches[0];dragX+=(t.clientX-lmx)*0.006;dragY+=(t.clientY-lmy)*0.006;lmx=t.clientX;lmy=t.clientY},{passive:true});

let zoom=1.0;
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom*=e.deltaY>0?0.92:1.08;zoom=Math.max(0.05,Math.min(30,zoom))},{passive:false});

function resize(){const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=window.innerWidth*dpr;canvas.height=window.innerHeight*dpr;gl.viewport(0,0,canvas.width,canvas.height);document.getElementById('res').textContent=canvas.width+'×'+canvas.height}
window.addEventListener('resize',resize);resize();

let timescale=0.5,density=10000,spiral=0.7,tilt=2.8;
const arms=Math.floor(Math.random()*4)+2;
const TIME_OFFSET=500+Math.random()*800;
let needsRegen=false;

function bind(id,valId,cb){const s=document.getElementById(id),l=document.getElementById(valId);s.addEventListener('input',()=>cb(s,l))}
bind('timescale','tsVal',(s,l)=>{timescale=parseInt(s.value)/100;l.textContent=timescale.toFixed(2)+'×'});
bind('density','densityVal',(s,l)=>{density=parseInt(s.value);l.textContent=density;needsRegen=true});
bind('spiral','spiralVal',(s,l)=>{spiral=parseInt(s.value)/100;l.textContent=spiral.toFixed(2)});
bind('tilt','tiltVal',(s,l)=>{tilt=parseInt(s.value)/10;l.textContent=tilt.toFixed(1)});

generateStars(density,arms);

let frames=0,lastT=performance.now();const t0=performance.now();

function frame(){
  const now=performance.now(),time=(now-t0)/1000+TIME_OFFSET;
  frames++;if(now-lastT>500){document.getElementById('fps').textContent=Math.round(frames/((now-lastT)/1000))+' fps';frames=0;lastT=now}
  if(needsRegen){generateStars(density,arms);needsRegen=false}

  const w=canvas.width,h=canvas.height;

  gl.disable(gl.BLEND);
  gl.useProgram(coreProg);
  gl.uniform2f(coreU.u_res,w,h);gl.uniform4f(coreU.u_mouse,dragX,dragY,0,0);
  gl.uniform1f(coreU.u_zoom,zoom);gl.uniform1f(coreU.u_tilt,tilt);
  gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
  gl.enableVertexAttribArray(coreAttrPos);
  gl.vertexAttribPointer(coreAttrPos,2,gl.FLOAT,false,0,0);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  gl.disableVertexAttribArray(coreAttrPos);

  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
  gl.useProgram(starProg);
  gl.uniform1f(starU.u_time,time);gl.uniform1f(starU.u_timescale,timescale);
  gl.uniform2f(starU.u_res,w,h);gl.uniform4f(starU.u_mouse,dragX,dragY,0,0);
  gl.uniform1f(starU.u_zoom,zoom);gl.uniform1f(starU.u_tilt,tilt);
  gl.uniform1f(starU.u_spiral,spiral);
  gl.bindVertexArray(starVAO);
  gl.drawArrays(gl.POINTS,0,starCount);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);

  requestAnimationFrame(frame);
}
frame();
})();
