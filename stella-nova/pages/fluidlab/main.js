(async () => {
const RAW = {};
await Promise.all(["shaders/quad.vert.glsl","shaders/bilerp.frag.glsl","shaders/advect.frag.glsl","shaders/divergence.frag.glsl","shaders/jacobi.frag.glsl","shaders/gradient.frag.glsl","shaders/display.frag.glsl","shaders/copy.frag.glsl","shaders/diffuse.frag.glsl"].map(async (n) => {
  const r = await fetch(new URL(n, document.baseURI));
  if (!r.ok) throw new Error('shader fetch failed ('+r.status+'): '+n);
  RAW[n] = await r.text();
}));
const canvas=document.getElementById('sim-canvas');const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
if(!gl){alert('WebGL2 required');throw new Error('No WebGL2');}

// ═══ MOBILE FIX: Properly detect float texture + linear filtering support ═══
gl.getExtension('EXT_color_buffer_float');
gl.getExtension('EXT_color_buffer_half_float');
const hasFloatLinear=!!gl.getExtension('OES_texture_float_linear');
const hasHalfFloatLinear=!!gl.getExtension('OES_texture_half_float_linear');

function detectTexFormat(){
  while(gl.getError()!==gl.NO_ERROR){}
  const formats=[[gl.RGBA32F,gl.FLOAT,'RGBA32F'],[gl.RGBA16F,gl.HALF_FLOAT,'RGBA16F'],[gl.RGBA16F,gl.FLOAT,'RGBA16F/FLOAT'],[gl.RGBA8,gl.UNSIGNED_BYTE,'RGBA8']];
  for(const[ifmt,type,name] of formats){
    try{
      while(gl.getError()!==gl.NO_ERROR){}
      const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texImage2D(gl.TEXTURE_2D,0,ifmt,4,4,0,gl.RGBA,type,null);
      if(gl.getError()!==gl.NO_ERROR){gl.deleteTexture(t);continue;}
      // MOBILE FIX: Use NEAREST for test if linear filtering isn't supported for this type
      const canLinear=(type===gl.FLOAT&&hasFloatLinear)||(type===gl.HALF_FLOAT&&hasHalfFloatLinear)||(type===gl.UNSIGNED_BYTE);
      const filter=canLinear?gl.LINEAR:gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
      const ok=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(f);gl.deleteTexture(t);
      if(ok){console.log('FluidLab: using '+name+(canLinear?' (linear)':' (nearest)'));return{fmt:ifmt,type,name,canLinear};}
    }catch(e){continue;}
  }
  console.error('FluidLab: no renderable format found');return{fmt:gl.RGBA16F,type:gl.HALF_FLOAT,name:'FALLBACK',canLinear:false};
}
const{fmt:TEX_FMT,type:TEX_TYPE,name:TEX_NAME,canLinear:TEX_CAN_LINEAR}=detectTexFormat();
// MOBILE FIX: Use NEAREST when linear filtering isn't available for this float format
const TEX_FILTER=TEX_CAN_LINEAR?gl.LINEAR:gl.NEAREST;

// MOBILE FIX: Detect the correct readPixels type for the chosen framebuffer format
let READ_TYPE=gl.FLOAT;
let ReadArrayCtor=Float32Array;
(function detectReadFormat(){
  while(gl.getError()!==gl.NO_ERROR){}
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,TEX_FMT,4,4,0,gl.RGBA,TEX_TYPE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,TEX_FILTER);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,TEX_FILTER);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  // Ask the implementation what type it can actually read
  const implType=gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
  const implFmt=gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(f);gl.deleteTexture(t);
  if(implType===gl.FLOAT){READ_TYPE=gl.FLOAT;ReadArrayCtor=Float32Array;}
  else if(implType===gl.HALF_FLOAT){READ_TYPE=gl.HALF_FLOAT;ReadArrayCtor=Uint16Array;}
  else if(implType===gl.UNSIGNED_BYTE){READ_TYPE=gl.UNSIGNED_BYTE;ReadArrayCtor=Uint8Array;}
  else{READ_TYPE=gl.FLOAT;ReadArrayCtor=Float32Array;}
  console.log('FluidLab: readPixels type='+implType+' (FLOAT='+gl.FLOAT+', HALF='+gl.HALF_FLOAT+', UBYTE='+gl.UNSIGNED_BYTE+')');
})();

// Helper: decode read buffer value to float regardless of source type
function decodeReadValue(arr,i){
  if(ReadArrayCtor===Float32Array)return arr[i];
  if(ReadArrayCtor===Uint8Array)return(arr[i]/255.0)*2.0-1.0; // rough: map 0-255 to -1..1
  // HALF_FLOAT as Uint16 — manual decode
  const h=arr[i],s=(h>>15)&1,e=(h>>10)&0x1f,m=h&0x3ff;
  if(e===0)return(s?-1:1)*(m/1024)*Math.pow(2,-14);
  if(e===31)return m?NaN:(s?-Infinity:Infinity);
  return(s?-1:1)*Math.pow(2,e-15)*(1+m/1024);
}

const MAX_E=24,MAX_S=12;
const SIM={playing:true,gain:1.5,bloom:0.4,jacobiIters:40,drawMode:false,eraseMode:false,brushSize:16,selectedId:-1,selectedType:'',cmap:3,showVectors:false,cellSize:24,gravity:false,gravityStr:200,viscosity:0};
let emitters=[],shapes=[],nextId=0,frame=0,CW=100,CH=100,simW=100,simH=100;
let lastTime=performance.now(),deltaTime=0.016,fpsAccum=0,fpsCount=0;

/* ═══ COLORMAPS ═══ */
const CMAPS={predator:[[0,0,0],[.08,.02,.22],[.25,.05,.45],[.55,.08,.35],[.8,.2,.05],[1,.55,0],[1,.85,.3],[1,1,.92]],viridis:[[.267,.004,.329],[.283,.141,.458],[.254,.265,.530],[.164,.471,.558],[.128,.567,.551],[.134,.658,.517],[.478,.821,.318],[.993,.906,.144]],oceanic:[[.02,.02,.15],[.02,.1,.35],[0,.25,.55],[0,.45,.55],[0,.6,.5],[.1,.75,.45],[.4,.85,.3],[1,.95,.3]]};
function renderCmapPreviews(){document.querySelectorAll('.cmap-btn').forEach(btn=>{const c=btn.querySelector('canvas');c.width=120;c.height=24;const ctx=c.getContext('2d');const cm=+btn.dataset.cmap;const stops=cm===0?CMAPS.predator:cm===1?CMAPS.viridis:cm===2?CMAPS.oceanic:null;for(let x=0;x<120;x++){const t=x/119;if(stops){const n=stops.length-1,i=Math.min(Math.floor(t*n),n-1),f=t*n-i;ctx.fillStyle=`rgb(${(stops[i][0]+(stops[i+1][0]-stops[i][0])*f)*255|0},${(stops[i][1]+(stops[i+1][1]-stops[i][1])*f)*255|0},${(stops[i][2]+(stops[i+1][2]-stops[i][2])*f)*255|0})`;}else ctx.fillStyle=`hsl(${t*360},80%,55%)`;ctx.fillRect(x,0,1,24);}});}
function setCmap(i){SIM.cmap=i;document.querySelectorAll('.cmap-btn').forEach(b=>b.classList.toggle('active',+b.dataset.cmap===i));}

/* ═══ OBJECTS ═══ */
function createEmitter(t,x,y){return{id:nextId++,kind:'emitter',type:t,x,y,angle:0,strength:t==='jet'?200:80,mult:1,width:t==='jet'?0.04:0.06,spin:0,dyeR:Math.random()*.7+.3,dyeG:Math.random()*.7+.3,dyeB:Math.random()*.7+.3,active:true};}
function createShape(t,x,y){const s={id:nextId++,kind:'shape',type:t,x,y,angle:0,spin:0,fixed:true,vx:0,vy:0,va:0,mass:2,w:60,h:60,teeth:10,points:5};
  if(t==='rect'){s.w=80;s.h=30;}if(t==='airfoil'){s.w=100;s.h=24;}if(t==='wedge'){s.w=60;s.h=50;}if(t==='gear'){s.w=70;s.h=70;}if(t==='star'){s.w=70;s.h=70;}if(t==='tesla'){s.w=160;s.h=60;}return s;}

/* ═══ BARRIER ═══ */
let barrierCanvas,barrierCtx,barrierTex,drawnCanvas,drawnCtx,barrierDirty=true;
function initBarrierCanvas(){barrierCanvas=document.createElement('canvas');barrierCanvas.width=simW;barrierCanvas.height=simH;barrierCtx=barrierCanvas.getContext('2d',{willReadFrequently:true});drawnCanvas=document.createElement('canvas');drawnCanvas.width=simW;drawnCanvas.height=simH;drawnCtx=drawnCanvas.getContext('2d');barrierDirty=true;}
function drawShapePath(ctx,type,sw,sh,teeth,pts){
  teeth=teeth||10;pts=pts||5;
  if(type==='circle'){ctx.beginPath();ctx.ellipse(0,0,sw/2,sh/2,0,0,Math.PI*2);ctx.fill();}
  else if(type==='rect'){ctx.fillRect(-sw/2,-sh/2,sw,sh);}
  else if(type==='airfoil'){ctx.beginPath();ctx.moveTo(sw/2,0);ctx.bezierCurveTo(sw*.3,-sh*.55,-sw*.3,-sh*.25,-sw/2,0);ctx.bezierCurveTo(-sw*.3,sh*.25,sw*.3,sh*.55,sw/2,0);ctx.fill();}
  else if(type==='wedge'){ctx.beginPath();ctx.moveTo(sw/2,0);ctx.lineTo(-sw/2,-sh/2);ctx.lineTo(-sw/2,sh/2);ctx.closePath();ctx.fill();}
  else if(type==='gear'){const ys=sh/sw;ctx.save();ctx.scale(1,ys);const or=sw/2,ir=sw*.34,tw=Math.PI/teeth*.55;ctx.beginPath();for(let i=0;i<teeth;i++){const a=i/teeth*Math.PI*2;ctx.lineTo(Math.cos(a-tw)*or,Math.sin(a-tw)*or);ctx.lineTo(Math.cos(a+tw)*or,Math.sin(a+tw)*or);const m=a+Math.PI/teeth;ctx.lineTo(Math.cos(m-tw*.6)*ir,Math.sin(m-tw*.6)*ir);ctx.lineTo(Math.cos(m+tw*.6)*ir,Math.sin(m+tw*.6)*ir);}ctx.closePath();ctx.fill();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(0,0,sw*.15,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';ctx.restore();}
  else if(type==='star'){const ys=sh/sw;ctx.save();ctx.scale(1,ys);const or=sw/2,ir=sw*.2;ctx.beginPath();for(let i=0;i<pts*2;i++){const a=i/pts*Math.PI-Math.PI/2,r=i%2===0?or:ir;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.restore();}
  else if(type==='tesla'){const hw=sw/2,hh=sh/2,wt=sh*.08;ctx.fillRect(-hw,-hh,sw,wt);ctx.fillRect(-hw,hh-wt,sw,wt);const nd=3,seg=sw/(nd+1);for(let i=0;i<nd;i++){const cx=-hw+seg*(i+1),dir=i%2===0?-1:1;ctx.save();ctx.translate(cx,0);ctx.beginPath();ctx.moveTo(-seg*.3,dir*wt*.5);ctx.quadraticCurveTo(-seg*.05,dir*hh*.7,seg*.15,dir*hh*.5);ctx.lineTo(seg*.15,dir*(hh*.5-wt));ctx.quadraticCurveTo(-seg*.05,dir*(hh*.7-wt),-seg*.3,dir*(wt*.5+wt));ctx.closePath();ctx.fill();if(dir>0)ctx.fillRect(-wt/2,-hh*.3,wt,hh*.5);else ctx.fillRect(-wt/2,-hh*.2,wt,hh*.5);ctx.restore();}}}
function renderBarrierCanvas(){const ctx=barrierCtx;ctx.clearRect(0,0,simW,simH);ctx.fillStyle='#fff';for(const s of shapes){const sx=s.x/CW*simW,sy=(1-s.y/CH)*simH,sw=s.w/CW*simW,sh=s.h/CH*simH;ctx.save();ctx.translate(sx,sy);ctx.rotate(-s.angle);drawShapePath(ctx,s.type,sw,sh,s.teeth,s.points);ctx.restore();}ctx.drawImage(drawnCanvas,0,0);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,barrierCanvas);}

/* ═══ FLUID-COUPLED RIGID BODY PHYSICS ═══ */
function sampleVelocityAt(wx,wy){
  try{
    const u=wx/CW,v=1-wy/CH;
    const px=Math.max(0,Math.min(simW-1,Math.floor(u*simW))),py=Math.max(0,Math.min(simH-1,Math.floor(v*simH)));
    gl.bindFramebuffer(gl.FRAMEBUFFER,vF.read.fbo);
    // MOBILE FIX: Use the implementation's preferred read type
    const buf=new ReadArrayCtor(4);
    gl.readPixels(px,py,1,1,gl.RGBA,READ_TYPE,buf);
    if(gl.getError()!==gl.NO_ERROR){buf[0]=0;buf[1]=0;buf[2]=0;buf[3]=0;}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    while(gl.getError()!==gl.NO_ERROR){}
    return[decodeReadValue(buf,0),-decodeReadValue(buf,1)];
  }catch(e){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    while(gl.getError()!==gl.NO_ERROR){}
    return[0,0];
  }
}
function integrateShapes(){
  for(const s of shapes){if(s.spin!==0&&s!==dragObj)s.angle+=s.spin*deltaTime;}
  for(const e of emitters){if(e.spin!==0&&e!==dragObj)e.angle+=e.spin*deltaTime;}
  for(const s of shapes){
    if(s.fixed||s===dragObj)continue;
    const[fvx,fvy]=sampleVelocityAt(s.x,s.y);
    const drag=8.0;
    s.vx+=(fvx*drag-s.vx*0.3)*deltaTime*60;
    s.vy+=(fvy*drag-s.vy*0.3)*deltaTime*60;
    if(SIM.gravity) s.vy+=SIM.gravityStr*0.5*deltaTime;
    const[lvx]=sampleVelocityAt(s.x-10,s.y);
    const[rvx]=sampleVelocityAt(s.x+10,s.y);
    s.va+=(rvx-lvx)*0.5*deltaTime*60;
    s.x+=s.vx*deltaTime;s.y+=s.vy*deltaTime;s.angle+=s.va*deltaTime;
    const M=30;if(s.x<M){s.x=M;s.vx=Math.abs(s.vx)*0.3;}if(s.x>CW-M){s.x=CW-M;s.vx=-Math.abs(s.vx)*0.3;}
    if(s.y<M){s.y=M;s.vy=Math.abs(s.vy)*0.3;}if(s.y>CH-M){s.y=CH-M;s.vy=-Math.abs(s.vy)*0.3;}
    s.vx*=0.99;s.vy*=0.99;s.va*=0.95;s.va=Math.max(-6,Math.min(6,s.va));
  }
  const REST=0.15,PAD=8,SKIN=20,CD=10;
  for(let i=0;i<shapes.length;i++){const a=shapes[i],ra=Math.max(a.w,a.h)*.5+PAD;
    for(let j=i+1;j<shapes.length;j++){const b=shapes[j],rb=Math.max(b.w,b.h)*.5+PAD;
      const dx=b.x-a.x,dy=b.y-a.y,dist=Math.sqrt(dx*dx+dy*dy),md=ra+rb;
      if(dist<.1||dist>md+SKIN)continue;const nx=dx/dist,ny=dy/dist,aF=a.fixed||a===dragObj,bF=b.fixed||b===dragObj;
      const rvx=(a.vx||0)-(b.vx||0),rvy=(a.vy||0)-(b.vy||0),rvn=rvx*nx+rvy*ny;
      if(dist>=md){const t=1-(dist-md)/SKIN,f=t*500+rvn*CD*t;if(!aF){a.vx-=nx*f*deltaTime/a.mass;a.vy-=ny*f*deltaTime/a.mass;}if(!bF){b.vx+=nx*f*deltaTime/b.mass;b.vy+=ny*f*deltaTime/b.mass;}}
      else{const ol=md-dist;if(!(aF&&bF)){if(aF){b.x+=nx*ol;b.y+=ny*ol;}else if(bF){a.x-=nx*ol;a.y-=ny*ol;}else{a.x-=nx*ol*.5;a.y-=ny*ol*.5;b.x+=nx*ol*.5;b.y+=ny*ol*.5;}}
        if(!aF&&!bF&&rvn>0){const imp=rvn*(1+REST)/(1/a.mass+1/b.mass);a.vx-=imp/a.mass*nx;a.vy-=imp/a.mass*ny;b.vx+=imp/b.mass*nx;b.vy+=imp/b.mass*ny;}
        const df=rvn*CD;if(!aF){a.vx-=nx*df*deltaTime/a.mass;a.vy-=ny*df*deltaTime/a.mass;}if(!bF){b.vx+=nx*df*deltaTime/b.mass;b.vy+=ny*df*deltaTime/b.mass;}}
      if(!aF)a.va*=.8;if(!bF)b.va*=.8;}}
}

/* ═══ WEBGL ═══ */
function compS(t,s){const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh));throw new Error('Shader');}return sh;}
function mkP(v,f){const p=gl.createProgram();gl.attachShader(p,compS(gl.VERTEX_SHADER,v));gl.attachShader(p,compS(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Link');return p;}
function gU(p,ns){const u={};for(const n of ns)u[n]=gl.getUniformLocation(p,n);return u;}
function mkDF(w,h){const mk=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    const data=TEX_TYPE===gl.FLOAT?new Float32Array(w*h*4):TEX_TYPE===gl.HALF_FLOAT?new Uint16Array(w*h*4):new Uint8Array(w*h*4);
    gl.texImage2D(gl.TEXTURE_2D,0,TEX_FMT,w,h,0,gl.RGBA,TEX_TYPE,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);return{tex:t,fbo:f};};let a=mk(),b=mk();return{get read(){return a},get write(){return b},swap(){[a,b]=[b,a]}};}
function mkF(w,h){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  const data=TEX_TYPE===gl.FLOAT?new Float32Array(w*h*4):TEX_TYPE===gl.HALF_FLOAT?new Uint16Array(w*h*4):new Uint8Array(w*h*4);
  gl.texImage2D(gl.TEXTURE_2D,0,TEX_FMT,w,h,0,gl.RGBA,TEX_TYPE,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);return{tex:t,fbo:f};}
const qVAO=gl.createVertexArray();gl.bindVertexArray(qVAO);const qb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);function dq(){gl.bindVertexArray(qVAO);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
const VS=RAW['shaders/quad.vert.glsl'];

// Manual bilinear interpolation for mobile GPUs without OES_texture_float_linear
const BILERP_GLSL=TEX_CAN_LINEAR?'':RAW['shaders/bilerp.frag.glsl'];
const SAMPLE_VEL=TEX_CAN_LINEAR?'texture(uVelocity,sp).xy':'bilerp(uVelocity,sp,uInvRes).xy';
const SAMPLE_DYE=TEX_CAN_LINEAR?'texture(uDye,sp)':'bilerp(uDye,sp,uInvRes)';

const ADV_FS=eval('`'+RAW['shaders/advect.frag.glsl']+'`');

const DIV_FS=RAW['shaders/divergence.frag.glsl'];

const JAC_FS=RAW['shaders/jacobi.frag.glsl'];

const GRD_FS=RAW['shaders/gradient.frag.glsl'];

const DSP_FS=eval('`'+RAW['shaders/display.frag.glsl']+'`');

const aP=mkP(VS,ADV_FS),aU=gU(aP,['uVelocity','uDye','uBarrier','uInvRes','uDt','uAspect','uMode','uMousePos','uMouseDown','uMouseVortex','uGravity','uNumEmitters','uNumShapes',...Array.from({length:MAX_E},(_,i)=>[`uEmitA[${i}]`,`uEmitB[${i}]`,`uEmitC[${i}]`]).flat(),...Array.from({length:MAX_S},(_,i)=>`uShapeA[${i}]`)]);
const dP=mkP(VS,DIV_FS),dU=gU(dP,['uVelocity','uBarrier','uInvRes']);
const jP=mkP(VS,JAC_FS),jU=gU(jP,['uPressure','uDivergence','uBarrier','uInvRes']);
const gP=mkP(VS,GRD_FS),gUn=gU(gP,['uPressure','uVelocity','uBarrier','uInvRes']);
const rP=mkP(VS,DSP_FS),rU=gU(rP,['uVelocity','uDye','uBarrier','uGain','uBloom','uCmap']);

/* ═══ VISCOUS DIFFUSION ═══
   Implicit backward-Euler: (I - νΔt∇²)u = u*, Jacobi-solved.
   Unconditionally stable, well-conditioned (diagonal 1+4a dominates), so ~20 sweeps converge.
   Only runs when ν>0, so the default (ν=0) path is identical in cost to before. */
const COPY_FS=RAW['shaders/copy.frag.glsl'];
const DIFF_FS=RAW['shaders/diffuse.frag.glsl'];
const cP=mkP(VS,COPY_FS),cU=gU(cP,['uTex']);
const fP=mkP(VS,DIFF_FS),fU=gU(fP,['uVel','uVel0','uBarrier','uInvRes','uA']);
const DIFFUSE_ITERS=20;

let vF,pF,dvF,dyF,u0F;
function initFBOs(){const isMob=window.innerWidth<600;const scale=isMob?0.5:0.75;
  // MOBILE FIX: Maintain screen aspect ratio in sim grid.
  // Old code forced 384×384 square on portrait screens, distorting all shapes.
  const maxSide=isMob?384:1024;
  if(canvas.width>=canvas.height){simW=Math.min(Math.floor(canvas.width*scale),maxSide);simH=Math.max(64,Math.round(simW*canvas.height/canvas.width));}
  else{simH=Math.min(Math.floor(canvas.height*scale),maxSide);simW=Math.max(64,Math.round(simH*canvas.width/canvas.height));}
  simW=Math.max(simW,64);simH=Math.max(simH,64);vF=mkDF(simW,simH);pF=mkDF(simW,simH);dvF=mkF(simW,simH);dyF=mkDF(simW,simH);u0F=mkF(simW,simH);
  barrierTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,simW,simH,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);initBarrierCanvas();document.getElementById('st-res').textContent=simW+'×'+simH+(TEX_CAN_LINEAR?'':' [nearest]');}
function resize(){const w=document.getElementById('canvas-wrap');CW=w.clientWidth;CH=w.clientHeight;if(CW<10||CH<10){CW=300;CH=300;}const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.floor(CW*dpr);canvas.height=Math.floor(CH*dpr);initFBOs();frame=0;}
if(window.ResizeObserver)new ResizeObserver(()=>resize()).observe(document.getElementById('canvas-wrap'));else window.addEventListener('resize',resize);

function step(){const inv=[1/simW,1/simH],asp=simW/simH;integrateShapes();
  let nb=barrierDirty;for(const s of shapes)if(s.spin!==0||!s.fixed){nb=true;break;}if(nb){renderBarrierCanvas();barrierDirty=false;}
  gl.viewport(0,0,simW,simH);
  gl.bindFramebuffer(gl.FRAMEBUFFER,vF.write.fbo);gl.useProgram(aP);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(aU.uVelocity,0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dyF.read.tex);gl.uniform1i(aU.uDye,1);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(aU.uBarrier,2);
  gl.uniform2f(aU.uInvRes,inv[0],inv[1]);gl.uniform1f(aU.uDt,deltaTime);gl.uniform1f(aU.uAspect,asp);gl.uniform1i(aU.uMode,0);
  gl.uniform2f(aU.uMousePos,mouse.x,mouse.y);
  gl.uniform1f(aU.uMouseDown,(mouse.down&&!SIM.drawMode&&!SIM.eraseMode)?1:0);
  gl.uniform1f(aU.uMouseVortex,mouseVortex);
  gl.uniform1f(aU.uGravity,SIM.gravity?SIM.gravityStr:0);
  gl.uniform1i(aU.uNumEmitters,emitters.length);gl.uniform1i(aU.uNumShapes,shapes.length);
  for(let i=0;i<MAX_E;i++){const e=emitters[i];if(e&&e.active){const ca=Math.cos(e.angle),sa=Math.sin(e.angle);let dx=ca,dy=-sa;const et=e.type==='jet'?0:e.type==='point'?1:2;if(e.type==='point'){dx=0;dy=0;}if(e.type==='vortex'){dx=-sa;dy=-ca;}gl.uniform4f(aU[`uEmitA[${i}]`],e.x/CW,1-e.y/CH,dx,dy);gl.uniform4f(aU[`uEmitB[${i}]`],e.strength*(e.mult||1),e.width,et,1);gl.uniform4f(aU[`uEmitC[${i}]`],e.dyeR,e.dyeG,e.dyeB,0);}else{gl.uniform4f(aU[`uEmitA[${i}]`],0,0,0,0);gl.uniform4f(aU[`uEmitB[${i}]`],0,0,0,0);gl.uniform4f(aU[`uEmitC[${i}]`],0,0,0,0);}}
  for(let i=0;i<MAX_S;i++){const s=shapes[i];if(s)gl.uniform4f(aU[`uShapeA[${i}]`],s.x/CW,1-s.y/CH,s.spin,Math.max(s.w,s.h)/2/CW);else gl.uniform4f(aU[`uShapeA[${i}]`],0,0,0,0);}
  dq();vF.swap();
  // ── Viscous diffusion (only when ν>0; zero cost otherwise) ──
  if(SIM.viscosity>1e-4){
    const a=SIM.viscosity*deltaTime;
    // stash u* (post-advection velocity) as the fixed RHS
    gl.bindFramebuffer(gl.FRAMEBUFFER,u0F.fbo);gl.useProgram(cP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(cU.uTex,0);dq();
    gl.useProgram(fP);gl.uniform1f(fU.uA,a);gl.uniform2f(fU.uInvRes,inv[0],inv[1]);
    for(let i=0;i<DIFFUSE_ITERS;i++){
      gl.bindFramebuffer(gl.FRAMEBUFFER,vF.write.fbo);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(fU.uVel,0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,u0F.tex);gl.uniform1i(fU.uVel0,1);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(fU.uBarrier,2);
      dq();vF.swap();
    }
  }
  gl.useProgram(aP);gl.bindFramebuffer(gl.FRAMEBUFFER,dyF.write.fbo);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(aU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dyF.read.tex);gl.uniform1i(aU.uDye,1);gl.uniform1i(aU.uMode,1);dq();dyF.swap();
  gl.bindFramebuffer(gl.FRAMEBUFFER,dvF.fbo);gl.useProgram(dP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(dU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(dU.uBarrier,1);gl.uniform2f(dU.uInvRes,inv[0],inv[1]);dq();
  gl.useProgram(jP);for(let i=0;i<SIM.jacobiIters;i++){gl.bindFramebuffer(gl.FRAMEBUFFER,pF.write.fbo);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pF.read.tex);gl.uniform1i(jU.uPressure,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dvF.tex);gl.uniform1i(jU.uDivergence,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(jU.uBarrier,2);gl.uniform2f(jU.uInvRes,inv[0],inv[1]);dq();pF.swap();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,vF.write.fbo);gl.useProgram(gP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pF.read.tex);gl.uniform1i(gUn.uPressure,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(gUn.uVelocity,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(gUn.uBarrier,2);gl.uniform2f(gUn.uInvRes,inv[0],inv[1]);dq();vF.swap();}

function display(){
  if(barrierDirty){renderBarrierCanvas();barrierDirty=false;}
  gl.viewport(0,0,canvas.width,canvas.height);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(rP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(rU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dyF.read.tex);gl.uniform1i(rU.uDye,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(rU.uBarrier,2);gl.uniform1f(rU.uGain,SIM.gain);gl.uniform1f(rU.uBloom,SIM.bloom);gl.uniform1i(rU.uCmap,SIM.cmap);dq();drawOverlays();}

/* ═══ OVERLAY ═══ */
let overlayCanvas,overlayCtx;
function initOverlay(){overlayCanvas=document.createElement('canvas');overlayCanvas.id='display-canvas';overlayCanvas.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;cursor:crosshair';document.getElementById('canvas-wrap').appendChild(overlayCanvas);overlayCtx=overlayCanvas.getContext('2d');}
function drawOverlays(){const dpr=Math.min(window.devicePixelRatio||1,2);if(overlayCanvas.width!==Math.floor(CW*dpr)||overlayCanvas.height!==Math.floor(CH*dpr)){overlayCanvas.width=Math.floor(CW*dpr);overlayCanvas.height=Math.floor(CH*dpr);}const ctx=overlayCtx;ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(canvas,0,0,overlayCanvas.width,overlayCanvas.height);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  for(const e of emitters){const sel=SIM.selectedId===e.id&&SIM.selectedType==='emitter';ctx.save();ctx.translate(e.x,e.y);ctx.rotate(e.angle);const hw=Math.max(e.width*CH,12);const ec=`rgb(${e.dyeR*255|0},${e.dyeG*255|0},${e.dyeB*255|0})`;
    if(e.type==='point'||e.type==='vortex'){ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;ctx.beginPath();ctx.arc(0,0,hw,0,Math.PI*2);ctx.stroke();if(e.type==='vortex'){ctx.strokeStyle='rgba(150,200,255,0.15)';ctx.lineWidth=1;for(let a=0;a<6;a++){const ang=a*Math.PI/3;ctx.beginPath();ctx.arc(0,0,hw*.65,ang,ang+.8);ctx.stroke();}}ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle=ec;ctx.fill();}
    else{const jd=6;ctx.fillStyle=sel?'rgba(255,200,50,0.12)':'rgba(255,200,50,0.05)';ctx.fillRect(-jd/2,-hw,jd,hw*2);ctx.strokeStyle=sel?ec:'rgba(255,200,50,0.3)';ctx.lineWidth=sel?2:1;ctx.strokeRect(-jd/2,-hw,jd,hw*2);ctx.strokeStyle=ec;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(jd/2,0);ctx.lineTo(jd/2+16,0);ctx.moveTo(jd/2+12,-4);ctx.lineTo(jd/2+16,0);ctx.lineTo(jd/2+12,4);ctx.stroke();}
    if(e.spin!==0){ctx.strokeStyle='rgba(100,200,100,0.35)';ctx.lineWidth=1;const r=hw+8,dir=e.spin>0?1:-1;ctx.beginPath();ctx.arc(0,0,r,0,dir*Math.PI*1.2);ctx.stroke();}ctx.restore();}
  for(const s of shapes){const sel=SIM.selectedId===s.id&&SIM.selectedType==='shape';ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.angle);ctx.strokeStyle=sel?'rgba(150,200,255,0.7)':'rgba(150,200,255,0.2)';ctx.lineWidth=sel?2:1;ctx.setLineDash(sel?[]:[4,4]);
    if(s.type==='circle'){ctx.beginPath();ctx.arc(0,0,s.w/2,0,Math.PI*2);ctx.stroke();}else if(s.type==='rect'){ctx.strokeRect(-s.w/2,-s.h/2,s.w,s.h);}else if(s.type==='airfoil'){ctx.beginPath();ctx.moveTo(s.w/2,0);ctx.bezierCurveTo(s.w*.3,-s.h*.55,-s.w*.3,-s.h*.25,-s.w/2,0);ctx.bezierCurveTo(-s.w*.3,s.h*.25,s.w*.3,s.h*.55,s.w/2,0);ctx.stroke();}else if(s.type==='wedge'){ctx.beginPath();ctx.moveTo(s.w/2,0);ctx.lineTo(-s.w/2,-s.h/2);ctx.lineTo(-s.w/2,s.h/2);ctx.closePath();ctx.stroke();}
    else if(s.type==='gear'){const teeth=s.teeth||10,or=s.w/2,ir=s.w*.34,tw=Math.PI/teeth*.55;ctx.beginPath();for(let i=0;i<teeth;i++){const a=i/teeth*Math.PI*2;ctx.lineTo(Math.cos(a-tw)*or,Math.sin(a-tw)*or);ctx.lineTo(Math.cos(a+tw)*or,Math.sin(a+tw)*or);const m=a+Math.PI/teeth;ctx.lineTo(Math.cos(m-tw*.6)*ir,Math.sin(m-tw*.6)*ir);ctx.lineTo(Math.cos(m+tw*.6)*ir,Math.sin(m+tw*.6)*ir);}ctx.closePath();ctx.stroke();}
    else if(s.type==='star'){const pts=s.points||5,or=s.w/2,ir=s.w*.2;ctx.beginPath();for(let i=0;i<pts*2;i++){const a=i/pts*Math.PI-Math.PI/2,r=i%2===0?or:ir;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.stroke();}
    else if(s.type==='tesla'){ctx.strokeRect(-s.w/2,-s.h/2,s.w,s.h);}
    ctx.setLineDash([]);if(s.spin!==0){ctx.strokeStyle='rgba(100,200,100,0.35)';ctx.lineWidth=1;const r=Math.max(s.w,s.h)*.4,dir=s.spin>0?1:-1;ctx.beginPath();ctx.arc(0,0,r,0,dir*Math.PI*1.2);ctx.stroke();}
    if(!s.fixed){ctx.strokeStyle='rgba(100,200,100,0.3)';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(0,0,Math.max(s.w,s.h)*.6,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}ctx.restore();}

  // Vector field overlay
  if(SIM.showVectors && vF){
    const cs=SIM.cellSize;
    const arrowMax=cs*0.55;
    try{
      gl.bindFramebuffer(gl.FRAMEBUFFER,vF.read.fbo);
      // MOBILE FIX: Use correct read type for vector field
      const vd=new ReadArrayCtor(simW*simH*4);
      gl.readPixels(0,0,simW,simH,gl.RGBA,READ_TYPE,vd);
      if(gl.getError()!==gl.NO_ERROR){gl.bindFramebuffer(gl.FRAMEBUFFER,null);ctx.restore();return;}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      ctx.save();
      ctx.strokeStyle='rgba(200,220,255,0.5)';
      ctx.fillStyle='rgba(200,220,255,0.5)';
      ctx.lineWidth=1.3;
      ctx.lineCap='round';
      for(let sx=cs/2;sx<CW;sx+=cs){
        for(let sy=cs/2;sy<CH;sy+=cs){
          const tu=sx/CW,tv=1-sy/CH;
          const px=Math.max(0,Math.min(simW-1,Math.floor(tu*simW)));
          const py=Math.max(0,Math.min(simH-1,Math.floor(tv*simH)));
          const idx=4*(py*simW+px);
          const vx=decodeReadValue(vd,idx),vy=-decodeReadValue(vd,idx+1);
          const speed=Math.sqrt(vx*vx+vy*vy);
          if(speed<0.5)continue;
          const len=Math.min(speed*0.18,arrowMax);
          const nx=vx/speed,ny=vy/speed;
          const ex=sx+nx*len,ey=sy+ny*len;
          ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
          if(len>3){
            const hx=-ny*3,hy=nx*3;
            ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-nx*5+hx,ey-ny*5+hy);ctx.lineTo(ex-nx*5-hx,ey-ny*5-hy);ctx.closePath();ctx.fill();
          }
        }
      }
      ctx.restore();
    }catch(e){gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  }

  if(SIM.drawMode||SIM.eraseMode){ctx.strokeStyle=SIM.eraseMode?'rgba(255,80,80,0.5)':'rgba(150,200,255,0.5)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(mouse.screenX,mouse.screenY,SIM.brushSize/2,0,Math.PI*2);ctx.stroke();}}

/* ═══ INPUT ═══ */
let mouse={x:0,y:0,screenX:0,screenY:0,down:false,px:0,py:0};
let dragObj=null,dragOffX=0,dragOffY=0,rotating=false;
let mouseVortex=0;

function gp(e){const r=document.getElementById('canvas-wrap').getBoundingClientRect();const t=e.touches?e.touches[0]:e;return{sx:t.clientX-r.left,sy:t.clientY-r.top};}
function hitObj(sx,sy){for(let i=emitters.length-1;i>=0;i--){const e=emitters[i];if(Math.sqrt((sx-e.x)**2+(sy-e.y)**2)<e.width*CH+15)return{obj:e,type:'emitter'};}
  for(let i=shapes.length-1;i>=0;i--){const s=shapes[i];const ca=Math.cos(-s.angle),sa=Math.sin(-s.angle);const dx=sx-s.x,dy=sy-s.y;if(Math.abs(dx*ca-dy*sa)<s.w/2+12&&Math.abs(dx*sa+dy*ca)<s.h/2+12)return{obj:s,type:'shape'};}return null;}

function onDown(e){e.preventDefault();const{sx,sy}=gp(e);mouse.screenX=sx;mouse.screenY=sy;
  if(SIM.drawMode||SIM.eraseMode){mouse.down=true;drawBrush(sx,sy);return;}
  const hit=hitObj(sx,sy);
  if(hit){dragObj=hit.obj;dragOffX=hit.obj.x-sx;dragOffY=hit.obj.y-sy;rotating=e.shiftKey;SIM.selectedId=hit.obj.id;SIM.selectedType=hit.type;rebuildList();}
  else{mouse.down=true;mouseVortex=(e.button===2)?-1:1;
    mouse.x=sx/CW;mouse.y=1-sy/CH;mouse.px=mouse.x;mouse.py=mouse.y;SIM.selectedId=-1;rebuildList();}}
function onMove(e){const{sx,sy}=gp(e);mouse.screenX=sx;mouse.screenY=sy;
  if(SIM.drawMode||SIM.eraseMode){if(mouse.down)drawBrush(sx,sy);return;}
  if(dragObj){e.preventDefault();if(rotating)dragObj.angle=Math.atan2(sy-dragObj.y,sx-dragObj.x);else{dragObj.x=sx+dragOffX;dragObj.y=sy+dragOffY;}barrierDirty=true;return;}
  if(mouse.down){mouse.x=sx/CW;mouse.y=1-sy/CH;}}
function onUp(){if(dragObj){dragObj.vx=0;dragObj.vy=0;}dragObj=null;rotating=false;mouse.down=false;mouseVortex=0;}

/* ═══ DRAW ═══ */
function drawBrush(sx,sy){const bx=sx/CW*simW,by=(1-sy/CH)*simH,r=SIM.brushSize/CW*simW;
  if(SIM.eraseMode){drawnCtx.globalCompositeOperation='destination-out';drawnCtx.beginPath();drawnCtx.arc(bx,by,r,0,Math.PI*2);drawnCtx.fill();drawnCtx.globalCompositeOperation='source-over';}
  else{drawnCtx.fillStyle='#fff';drawnCtx.beginPath();drawnCtx.arc(bx,by,r,0,Math.PI*2);drawnCtx.fill();}barrierDirty=true;}
function clearDrawn(){drawnCtx.clearRect(0,0,simW,simH);barrierDirty=true;}
function toggleDraw(){SIM.drawMode=!SIM.drawMode;if(SIM.drawMode)SIM.eraseMode=false;updD();}
function toggleErase(){SIM.eraseMode=!SIM.eraseMode;if(SIM.eraseMode)SIM.drawMode=false;updD();}
function updD(){document.getElementById('tog-draw').className='tog-btn '+(SIM.drawMode?'on':'off');document.getElementById('tog-erase').className='tog-btn '+(SIM.eraseMode?'on':'off');if(overlayCanvas)overlayCanvas.style.cursor=(SIM.drawMode||SIM.eraseMode)?'none':'crosshair';document.getElementById('st-mode').textContent=SIM.drawMode?'draw':SIM.eraseMode?'erase':'vortex';}

/* ═══ UI ═══ */
function sg(el){el.style.setProperty('--pct',((el.value-el.min)/(el.max-el.min)*100)+'%');}
document.querySelectorAll('#panel input[type=range]').forEach(sg);

function bindSlider(inp, obj, prop, kind) {
  inp.addEventListener('input', function() {
    obj[prop] = +this.value;
    sg(this);
    const v = this.closest('.mag-row').querySelector('.val');
    if (v) {
      if (prop==='angle') v.textContent = (obj[prop]*180/Math.PI).toFixed(0)+'°';
      else if (typeof obj[prop]==='number' && obj[prop]%1!==0) v.textContent = obj[prop].toFixed(2);
      else v.textContent = obj[prop];
    }
    if (kind==='shape') barrierDirty = true;
  });
}

function rebuildList(){
  const list=document.getElementById('obj-list');list.innerHTML='';
  const eI={jet:'▸',point:'◉',vortex:'◎'},sI={circle:'●',rect:'▬',airfoil:'◗',wedge:'◣',gear:'⚙',star:'★',tesla:'⇌'};
  const allObjs=[];
  emitters.forEach(e=>allObjs.push({obj:e,kind:'emitter'}));
  shapes.forEach(s=>allObjs.push({obj:s,kind:'shape'}));
  allObjs.sort((a,b)=>a.obj.id-b.obj.id);

  for(const entry of allObjs){
    const obj=entry.obj, kind=entry.kind, isE=kind==='emitter';
    const sel=SIM.selectedId===obj.id;
    const c=document.createElement('div');
    c.className='obj-card'+(sel?' selected':'');

    const capturedId=obj.id, capturedKind=kind;
    c.addEventListener('click', function(e){
      if(e.target.closest('input')||e.target.closest('button'))return;
      SIM.selectedId=capturedId;SIM.selectedType=capturedKind;rebuildList();
    });

    let head=`<div class="obj-card-head"><span class="obj-card-icon">${isE?eI[obj.type]:sI[obj.type]}</span><span class="obj-card-name">${isE?'EMIT':'SHAPE'} · ${obj.type.toUpperCase()}</span><button class="obj-card-dup" style="background:transparent;border:none;color:var(--text-faint);cursor:pointer;font-size:0.7rem;padding:2px 4px" title="Duplicate">⧉</button><button class="obj-card-del">✕</button></div>`;
    let rows='';
    if(isE){
      const curMult=obj.mult||1;
      rows=`<div class="mag-row"><span class="mag-row-lbl">Str</span><input type="range" data-p="strength" min="1" max="1000" value="${obj.strength}" step="5"><span class="val">${obj.strength}</span></div>`
        +`<div style="display:flex;gap:2px;margin:2px 0 6px;flex-wrap:wrap">`
        +[1,10,100,1e3,1e4,1e5].map(m=>`<button class="sim-btn${curMult===m?' active':''}" data-mult="${m}" style="flex:1;padding:4px 2px;font-size:0.5rem;min-width:0">×${m>=1000?(m/1000)+'K':m}</button>`).join('')
        +`</div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Width</span><input type="range" data-p="width" min="0.01" max="0.35" value="${obj.width}" step="0.005"><span class="val">${obj.width.toFixed(2)}</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Angle</span><input type="range" data-p="angle" min="-3.14159" max="3.14159" value="${obj.angle}" step="0.05"><span class="val">${(obj.angle*180/Math.PI).toFixed(0)}°</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Spin</span><input type="range" data-p="spin" min="-12" max="12" value="${obj.spin}" step="0.25"><span class="val">${obj.spin.toFixed(1)}</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Color</span><input type="color" data-p="color" value="${'#'+(1<<24|((obj.dyeR*255|0)<<16)|((obj.dyeG*255|0)<<8)|(obj.dyeB*255|0)).toString(16).slice(1)}" style="flex:1;height:22px;border:1px solid var(--border-b);background:transparent;cursor:pointer"><span class="val" style="min-width:0"></span></div>`;
    } else {
      rows=`<div class="mag-row"><span class="mag-row-lbl">Width</span><input type="range" data-p="w" min="10" max="250" value="${obj.w}" step="2"><span class="val">${obj.w}</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Height</span><input type="range" data-p="h" min="10" max="250" value="${obj.h}" step="2"><span class="val">${obj.h}</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Angle</span><input type="range" data-p="angle" min="-3.14159" max="3.14159" value="${obj.angle}" step="0.05"><span class="val">${(obj.angle*180/Math.PI).toFixed(0)}°</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Spin</span><input type="range" data-p="spin" min="-12" max="12" value="${obj.spin}" step="0.25"><span class="val">${obj.spin.toFixed(1)}</span></div>`;
      if(obj.type==='gear')
        rows+=`<div class="mag-row"><span class="mag-row-lbl">Teeth</span><input type="range" data-p="teeth" min="3" max="24" value="${obj.teeth}" step="1"><span class="val">${obj.teeth}</span></div>`;
      if(obj.type==='star')
        rows+=`<div class="mag-row"><span class="mag-row-lbl">Points</span><input type="range" data-p="points" min="3" max="12" value="${obj.points}" step="1"><span class="val">${obj.points}</span></div>`;
      rows+=`<button class="tog-btn ${obj.fixed?'off':'on'}">🔒 ${obj.fixed?'Fixed':'Dynamic'}</button>`;
    }
    c.innerHTML=head+rows;
    list.appendChild(c);

    c.querySelectorAll('input[type=range]').forEach(inp=>{
      const prop=inp.dataset.p;
      if(prop) bindSlider(inp, obj, prop, kind);
      sg(inp);
    });

    const colorInp=c.querySelector('input[type=color]');
    if(colorInp){
      colorInp.addEventListener('input', function(){
        const hex=this.value;
        obj.dyeR=parseInt(hex.slice(1,3),16)/255;
        obj.dyeG=parseInt(hex.slice(3,5),16)/255;
        obj.dyeB=parseInt(hex.slice(5,7),16)/255;
      });
    }

    c.querySelectorAll('[data-mult]').forEach(btn=>{
      btn.addEventListener('click', function(){
        obj.mult=+this.dataset.mult;
        rebuildList();
      });
    });

    const delBtn=c.querySelector('.obj-card-del');
    if(delBtn) delBtn.addEventListener('click', function(){removeObj(capturedId,capturedKind);});

    const dupBtn=c.querySelector('.obj-card-dup');
    if(dupBtn) dupBtn.addEventListener('click', function(){duplicateObj(capturedId,capturedKind);});

    const togBtn=c.querySelector('.tog-btn');
    if(togBtn) togBtn.addEventListener('click', function(){toggleFixed(capturedId);});
  }
  document.getElementById('st-obj').textContent=(emitters.length+shapes.length)+' objects';
}
function toggleFixed(id){const s=shapes.find(o=>o.id===id);if(!s)return;s.fixed=!s.fixed;s.vx=0;s.vy=0;s.va=0;rebuildList();}
function findSpot(){const all=[...emitters,...shapes];for(let ring=0;ring<8;ring++){const r=ring*60,steps=Math.max(1,ring*6);for(let s=0;s<steps;s++){const a=s/steps*Math.PI*2,tx=CW/2+Math.cos(a)*r,ty=CH/2+Math.sin(a)*r;let ok=true;for(const o of all)if((tx-o.x)**2+(ty-o.y)**2<3600){ok=false;break;}if(ok)return{x:Math.max(40,Math.min(CW-40,tx)),y:Math.max(40,Math.min(CH-40,ty))};}}return{x:CW/2,y:CH/2};}
function addEmitter(t){if(emitters.length>=MAX_E)return;const{x,y}=findSpot();const e=createEmitter(t,x,y);emitters.push(e);SIM.selectedId=e.id;SIM.selectedType='emitter';rebuildList();if(window.innerWidth<600)document.getElementById('panel').classList.remove('mob-open');}
function addShape(t){if(shapes.length>=MAX_S)return;const{x,y}=findSpot();const s=createShape(t,x,y);shapes.push(s);SIM.selectedId=s.id;SIM.selectedType='shape';barrierDirty=true;rebuildList();if(window.innerWidth<600)document.getElementById('panel').classList.remove('mob-open');}
function removeObj(id,kind){if(kind==='emitter')emitters=emitters.filter(e=>e.id!==id);else{shapes=shapes.filter(s=>s.id!==id);barrierDirty=true;}if(SIM.selectedId===id)SIM.selectedId=-1;rebuildList();}
function duplicateObj(id,kind){
  const arr=kind==='emitter'?emitters:shapes;
  const src=arr.find(x=>x.id===id);if(!src)return;
  if(kind==='emitter'&&emitters.length>=MAX_E)return;
  if(kind==='shape'&&shapes.length>=MAX_S)return;
  const copy={...src,id:nextId++,x:src.x+30,y:src.y+30,vx:0,vy:0,va:0};
  arr.push(copy);SIM.selectedId=copy.id;SIM.selectedType=kind;
  if(kind==='shape')barrierDirty=true;rebuildList();
}
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'▶ Play':'▐▐ Pause';b.classList.toggle('active',SIM.playing);}
function resetSim(){frame=0;initFBOs();barrierDirty=true;}
function clearAll(){emitters=[];shapes=[];SIM.selectedId=-1;if(drawnCtx)drawnCtx.clearRect(0,0,simW,simH);barrierDirty=true;resetSim();rebuildList();}

function preset(name){clearAll();
  if(name==='windtunnel'){
    const n=20;for(let i=0;i<n;i++){
      const y=CH*(i+0.5)/n;
      const e=createEmitter('jet',15,y);e.strength=30;e.width=0.015;
      const h=i/n;e.dyeR=0.5+0.5*Math.cos(h*6.28);e.dyeG=0.5+0.5*Math.cos(h*6.28+2.09);e.dyeB=0.5+0.5*Math.cos(h*6.28+4.19);
      emitters.push(e);
    }
    const s=createShape('circle',CW*.35,CH/2);s.w=80;s.h=80;shapes.push(s);}
  else if(name==='karman'){const e=createEmitter('jet',30,CH/2);e.strength=80;e.width=.28;e.dyeR=.3;e.dyeG=1;e.dyeB=.4;emitters.push(e);const s=createShape('circle',CW*.25,CH/2);s.w=36;s.h=36;shapes.push(s);}
  else if(name==='propeller'){const e=createEmitter('jet',30,CH/2);e.strength=60;e.width=.18;e.dyeR=.4;e.dyeG=.6;e.dyeB=1;emitters.push(e);const s=createShape('rect',CW*.45,CH/2);s.w=80;s.h=12;s.spin=6;shapes.push(s);}
  else if(name==='jet'){const e1=createEmitter('jet',CW*.15,CH/2);e1.strength=300;e1.width=.02;e1.dyeR=1;e1.dyeG=.3;e1.dyeB=.1;emitters.push(e1);const e2=createEmitter('jet',CW*.15,CH*.35);e2.angle=.3;e2.strength=250;e2.width=.015;e2.dyeR=.1;e2.dyeG=.5;e2.dyeB=1;emitters.push(e2);const e3=createEmitter('jet',CW*.15,CH*.65);e3.angle=-.3;e3.strength=250;e3.width=.015;e3.dyeR=.2;e3.dyeG=1;e3.dyeB=.3;emitters.push(e3);}
  barrierDirty=true;rebuildList();}

function defaultSetup(){
  const e1=createEmitter('jet',40,CH*.42);e1.strength=100;e1.width=.06;e1.dyeR=.15;e1.dyeG=.5;e1.dyeB=1;emitters.push(e1);
  const e2=createEmitter('jet',40,CH*.58);e2.strength=100;e2.width=.06;e2.dyeR=1;e2.dyeG=.35;e2.dyeB=.1;emitters.push(e2);
  const s=createShape('circle',CW*.35,CH*.5);s.w=100;s.h=100;shapes.push(s);
  barrierDirty=true;rebuildList();}

function loop(now){requestAnimationFrame(loop);deltaTime=Math.min((now-lastTime)/1000,.033);lastTime=now;fpsAccum+=deltaTime;fpsCount++;
  if(fpsAccum>=.5){document.getElementById('st-fps').textContent=Math.round(fpsCount/fpsAccum)+' fps';fpsAccum=0;fpsCount=0;}
  if(SIM.playing){step();frame++;}display();document.getElementById('st-frame').textContent='frame '+frame;}

initOverlay();
overlayCanvas.addEventListener('contextmenu',e=>e.preventDefault());
overlayCanvas.addEventListener('mousedown',onDown);window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);
overlayCanvas.addEventListener('touchstart',e=>{if(e.touches.length===1)onDown(e);},{passive:false});overlayCanvas.addEventListener('touchmove',e=>{if(e.touches.length===1)onMove(e);},{passive:false});overlayCanvas.addEventListener('touchend',onUp,{passive:false});
resize();renderCmapPreviews();
setTimeout(()=>{defaultSetup();requestAnimationFrame(loop);},60);
window.SIM=SIM;window.sg=sg;window.setCmap=setCmap;window.addEmitter=addEmitter;window.addShape=addShape;window.toggleDraw=toggleDraw;window.toggleErase=toggleErase;window.clearDrawn=clearDrawn;window.preset=preset;window.togglePlay=togglePlay;window.resetSim=resetSim;window.clearAll=clearAll;
})();
