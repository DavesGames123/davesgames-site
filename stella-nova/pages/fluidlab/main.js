// ============================================================================
//  FLUIDLAB  ·  real-time 2D stable-fluids solver on the GPU (Stam 1999)
// ----------------------------------------------------------------------------
//  A Navier-Stokes fluid solved by operator splitting, one pass per stage, all
//  state held in floating-point textures. Velocity and dye ping-pong between
//  read/write framebuffers; each solver stage is one full-screen quad draw of
//  its own shader. Rigid shapes and hand-drawn walls become a barrier texture
//  the solver treats as no-flow cells. The CPU also runs a light rigid-body
//  physics pass coupled to the fluid by reading velocity back with readPixels.
//
//  SIMULATION DATA FLOW   (one step(); ► = a full-screen shader pass)
//  ------------------------------------------------------------------------
//     pointers · bursts ─▶ splat queue ►splat (vF, dyF)   Gaussian splats
//                        │
//     emitters · gravity · shape spin   (forces, added during advect)
//                        │
//     vF ►advect(uMode 0)──▶ vF*   ── if ν>0: copy u* to u0F, then ─┐
//        semi-Lagrangian backtrace + forces        diffuse ×20 ◀────┘  vF
//                        │  (velocity now advected, optionally viscous)
//     dyF ►advect(uMode 1, samples vF)──▶ dyF      dye carried by velocity
//                        │                               (fades by SIM.dyeFade)
//     if eps>0: vF ►curl──▶ cuF ►vorticity──▶ vF   confinement puts spin back
//                        │
//     vF ►divergence──▶ dvF ►jacobi ×N (pressure Poisson)──▶ pF
//                        │
//     vF, pF ►gradient──▶ vF        subtract ∇p, making vF divergence-free
//                        ▼
//                 display ► colormap + bloom ──▶ <canvas> ──▶ 2D overlay
//
//  TEXTURE ROLES
//  -------------
//     vF  velocity   (DoubleFBO, ping-pong)   pF  pressure   (DoubleFBO)
//     dyF dye/colour (DoubleFBO)              dvF divergence (single FBO)
//     u0F stashed u* for viscous solve (single)   barrierTex  no-flow mask
//     cuF scalar curl for vorticity confinement (single)
//     mkDF() builds a ping-pong pair (read/write/swap); mkF() a single FBO.
//
//  BARRIER: shapes are rasterized (drawShapePath) plus the drawn-wall canvas
//  into barrierCanvas, uploaded to barrierTex; every solver shader zeroes flow
//  where barrier > 0.1.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ------------------------------------------------------------------------
//      shader fetch ....... "const RAW"        load all .glsl before setup
//      format detect ...... "detectTexFormat"  pick a renderable float format
//      read-back .......... "decodeReadValue"  readPixels type handling
//      state .............. "const SIM"        solver + UI state
//      colormaps .......... "COLORMAPS"        dye/speed palettes
//      objects ............ "createEmitter"    emitter / shape factories
//      barrier ............ "BARRIER"          rasterize shapes to no-flow mask
//      rigid body ......... "RIGID BODY"       fluid-coupled CPU physics
//      gl helpers ......... "WEBGL"            compile, FBO, ping-pong, quad
//      programs ........... "const aP="        one program per solver stage
//      viscosity .......... "VISCOUS DIFFUSION" implicit diffuse solve
//      vorticity .......... "Vorticity confinement" curl + confinement programs
//      fbos ............... "initFBOs"         allocate sim grid textures
//      step ............... "function step"    the per-frame solver pipeline
//      display ............ "function display" render pass + overlays
//      splats ............. "SPLATS"           splat queue, pointer strokes, mirror
//      overlays ........... "OVERLAY"          2D icons, vectors, brush
//      input .............. "INPUT"            pointer events: drag, draw, stir
//      ui list ............ "rebuildList"      object cards + sliders
//      presets ............ "function preset"  scene setups
//      randomizer ......... "RANDOMIZER"       random scenes, splash bursts, dice, keys
//      loop ............... "function loop"    rAF: step + display + FPS
//      screensaver ........ "window.snSaver"   shell saver hook (lib/screensaver.js)
//      saver plate ........ "function saverPlate" label plate: equations + live values
// ============================================================================
(async () => {
// Fetch every shader stage in parallel before any GL setup, keyed by path.
const RAW = {};
await Promise.all(["shaders/quad.vert.glsl","shaders/bilerp.frag.glsl","shaders/advect.frag.glsl","shaders/divergence.frag.glsl","shaders/jacobi.frag.glsl","shaders/gradient.frag.glsl","shaders/display.frag.glsl","shaders/copy.frag.glsl","shaders/diffuse.frag.glsl","shaders/curl.frag.glsl","shaders/vorticity.frag.glsl","shaders/splat.frag.glsl"].map(async (n) => {
  const r = await fetch(new URL(n, document.baseURI));
  if (!r.ok) throw new Error('shader fetch failed ('+r.status+'): '+n);
  RAW[n] = await r.text();
}));
// WebGL2 context. preserveDrawingBuffer:true so the 2D overlay can copy the
// rendered frame; no depth/stencil since everything is full-screen 2D passes.
const canvas=document.getElementById('sim-canvas');const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
if(!gl){alert('WebGL2 required');throw new Error('No WebGL2');}
// The tab shell removes this iframe on a page swap. Drop the context so the
// browser does not run out of live WebGL contexts during heavy swapping.
window.addEventListener('pagehide',function(){try{if(gl)gl.getExtension('WEBGL_lose_context').loseContext();}catch(e){}});

// Enable float render targets and probe whether float/half-float textures can
// be linearly filtered; the sim needs renderable float textures for velocity
// and pressure, and falls back to manual bilinear filtering where hardware
// linear filtering of floats is missing.
// ═══ MOBILE FIX: Properly detect float texture + linear filtering support ═══
gl.getExtension('EXT_color_buffer_float');
gl.getExtension('EXT_color_buffer_half_float');
const hasFloatLinear=!!gl.getExtension('OES_texture_float_linear');
const hasHalfFloatLinear=!!gl.getExtension('OES_texture_half_float_linear');

// Find the best texture format the GPU can both render to and (ideally) filter.
// Try RGBA32F, then RGBA16F, then RGBA8, building a test framebuffer for each
// and keeping the first that reports FRAMEBUFFER_COMPLETE.
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
// readPixels on a float framebuffer may only accept a specific type; ask the
// implementation and pick the matching typed-array constructor for read-back.
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

// Convert one read-back sample to a float regardless of the buffer's type:
// pass Float32 through, remap bytes, or decode a half-float by hand.
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

// Hard caps on emitters and shapes; the shader declares uniform arrays this big.
const MAX_E=24,MAX_S=12;
// Splats per pass of splat.frag.glsl; a longer queue runs in more passes.
const MAX_SPL=16;
// The one global state object: play/pause, display gains, solver iteration
// counts, edit modes, colormap, vector overlay, gravity, viscosity, vorticity
// eps (curl), dye fade, and the pointer tool (tool, splat radius, force, ink,
// mirror count, rainbow or fixed ink colour).
const SIM={playing:true,gain:1.5,bloom:0.4,jacobiIters:40,curl:0,dyeFade:0.997,tool:'push',splatR:0.035,force:1.5,ink:0.5,mirror:1,rainbow:true,inkColor:[1,0.5,0.19],drawMode:false,eraseMode:false,brushSize:16,selectedId:-1,selectedType:'',cmap:3,showVectors:false,cellSize:24,gravity:false,gravityStr:200,viscosity:0};
// Object lists and running counters. CW/CH are canvas CSS size; simW/simH the
// simulation grid resolution (smaller than the canvas for speed).
let emitters=[],shapes=[],nextId=0,frame=0,CW=100,CH=100,simW=100,simH=100;
let lastTime=performance.now(),deltaTime=0.016,fpsAccum=0,fpsCount=0;

// Palette stops for the three speed colormaps (a fourth "Dye" mode shows the
// carried dye directly). Mirrored in display.frag.glsl for the GPU render.
/* ═══ COLORMAPS ═══ */
const CMAPS={predator:[[0,0,0],[.08,.02,.22],[.25,.05,.45],[.55,.08,.35],[.8,.2,.05],[1,.55,0],[1,.85,.3],[1,1,.92]],viridis:[[.267,.004,.329],[.283,.141,.458],[.254,.265,.530],[.164,.471,.558],[.128,.567,.551],[.134,.658,.517],[.478,.821,.318],[.993,.906,.144]],oceanic:[[.02,.02,.15],[.02,.1,.35],[0,.25,.55],[0,.45,.55],[0,.6,.5],[.1,.75,.45],[.4,.85,.3],[1,.95,.3]]};
// Paint each colormap button's preview strip by sampling its gradient.
function renderCmapPreviews(){document.querySelectorAll('.cmap-btn').forEach(btn=>{const c=btn.querySelector('canvas');c.width=120;c.height=24;const ctx=c.getContext('2d');const cm=+btn.dataset.cmap;const stops=cm===0?CMAPS.predator:cm===1?CMAPS.viridis:cm===2?CMAPS.oceanic:null;for(let x=0;x<120;x++){const t=x/119;if(stops){const n=stops.length-1,i=Math.min(Math.floor(t*n),n-1),f=t*n-i;ctx.fillStyle=`rgb(${(stops[i][0]+(stops[i+1][0]-stops[i][0])*f)*255|0},${(stops[i][1]+(stops[i+1][1]-stops[i][1])*f)*255|0},${(stops[i][2]+(stops[i+1][2]-stops[i][2])*f)*255|0})`;}else ctx.fillStyle=`hsl(${t*360},80%,55%)`;ctx.fillRect(x,0,1,24);}});}
// Select colormap i and mark its button active.
function setCmap(i){SIM.cmap=i;document.querySelectorAll('.cmap-btn').forEach(b=>b.classList.toggle('active',+b.dataset.cmap===i));}

// Object factories. An emitter injects velocity and dye (jet=directional line,
// point=omni, vortex=swirl); a shape is a rigid barrier with size and physics.
// An emitter's wander (radians) swings its angle at wf rad/s; wt is the phase.
/* ═══ OBJECTS ═══ */
function createEmitter(t,x,y){return{id:nextId++,kind:'emitter',type:t,x,y,angle:0,strength:t==='jet'?200:80,mult:1,width:t==='jet'?0.04:0.06,spin:0,wander:0,wf:0.6,wt:Math.random()*6.283,dyeR:Math.random()*.7+.3,dyeG:Math.random()*.7+.3,dyeB:Math.random()*.7+.3,active:true};}
function createShape(t,x,y){const s={id:nextId++,kind:'shape',type:t,x,y,angle:0,spin:0,fixed:true,vx:0,vy:0,va:0,mass:2,w:60,h:60,teeth:10,points:5};
  if(t==='rect'){s.w=80;s.h=30;}if(t==='airfoil'){s.w=100;s.h=24;}if(t==='wedge'){s.w=60;s.h=50;}if(t==='gear'){s.w=70;s.h=70;}if(t==='star'){s.w=70;s.h=70;}if(t==='tesla'){s.w=160;s.h=60;}return s;}

// Barrier state. barrierCanvas is the combined no-flow mask (shapes + drawn
// walls) uploaded to barrierTex; drawnCanvas holds only the hand-drawn walls so
// they persist while shapes move. barrierDirty forces a re-raster next frame.
/* ═══ BARRIER ═══ */
let barrierCanvas,barrierCtx,barrierTex,drawnCanvas,drawnCtx,barrierDirty=true;
// Allocate the two offscreen canvases at simulation resolution.
function initBarrierCanvas(){barrierCanvas=document.createElement('canvas');barrierCanvas.width=simW;barrierCanvas.height=simH;barrierCtx=barrierCanvas.getContext('2d',{willReadFrequently:true});drawnCanvas=document.createElement('canvas');drawnCanvas.width=simW;drawnCanvas.height=simH;drawnCtx=drawnCanvas.getContext('2d');barrierDirty=true;}
// Trace one shape's filled path into a 2D context at the origin (caller has
// already translated/rotated). Each shape type is a different canvas path.
function drawShapePath(ctx,type,sw,sh,teeth,pts){
  teeth=teeth||10;pts=pts||5;
  if(type==='circle'){ctx.beginPath();ctx.ellipse(0,0,sw/2,sh/2,0,0,Math.PI*2);ctx.fill();}
  else if(type==='rect'){ctx.fillRect(-sw/2,-sh/2,sw,sh);}
  else if(type==='airfoil'){ctx.beginPath();ctx.moveTo(sw/2,0);ctx.bezierCurveTo(sw*.3,-sh*.55,-sw*.3,-sh*.25,-sw/2,0);ctx.bezierCurveTo(-sw*.3,sh*.25,sw*.3,sh*.55,sw/2,0);ctx.fill();}
  else if(type==='wedge'){ctx.beginPath();ctx.moveTo(sw/2,0);ctx.lineTo(-sw/2,-sh/2);ctx.lineTo(-sw/2,sh/2);ctx.closePath();ctx.fill();}
  else if(type==='gear'){const ys=sh/sw;ctx.save();ctx.scale(1,ys);const or=sw/2,ir=sw*.34,tw=Math.PI/teeth*.55;ctx.beginPath();for(let i=0;i<teeth;i++){const a=i/teeth*Math.PI*2;ctx.lineTo(Math.cos(a-tw)*or,Math.sin(a-tw)*or);ctx.lineTo(Math.cos(a+tw)*or,Math.sin(a+tw)*or);const m=a+Math.PI/teeth;ctx.lineTo(Math.cos(m-tw*.6)*ir,Math.sin(m-tw*.6)*ir);ctx.lineTo(Math.cos(m+tw*.6)*ir,Math.sin(m+tw*.6)*ir);}ctx.closePath();ctx.fill();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(0,0,sw*.15,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';ctx.restore();}
  else if(type==='star'){const ys=sh/sw;ctx.save();ctx.scale(1,ys);const or=sw/2,ir=sw*.2;ctx.beginPath();for(let i=0;i<pts*2;i++){const a=i/pts*Math.PI-Math.PI/2,r=i%2===0?or:ir;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.restore();}
  else if(type==='tesla'){const hw=sw/2,hh=sh/2,wt=sh*.08;ctx.fillRect(-hw,-hh,sw,wt);ctx.fillRect(-hw,hh-wt,sw,wt);const nd=3,seg=sw/(nd+1);for(let i=0;i<nd;i++){const cx=-hw+seg*(i+1),dir=i%2===0?-1:1;ctx.save();ctx.translate(cx,0);ctx.beginPath();ctx.moveTo(-seg*.3,dir*wt*.5);ctx.quadraticCurveTo(-seg*.05,dir*hh*.7,seg*.15,dir*hh*.5);ctx.lineTo(seg*.15,dir*(hh*.5-wt));ctx.quadraticCurveTo(-seg*.05,dir*(hh*.7-wt),-seg*.3,dir*(wt*.5+wt));ctx.closePath();ctx.fill();if(dir>0)ctx.fillRect(-wt/2,-hh*.3,wt,hh*.5);else ctx.fillRect(-wt/2,-hh*.2,wt,hh*.5);ctx.restore();}}}
// Rebuild the no-flow mask: clear, draw every shape in white at its sim-space
// position and rotation, composite the drawn walls, then upload to barrierTex.
// Y is flipped (1 - y) because sim space has its origin at the bottom.
function renderBarrierCanvas(){const ctx=barrierCtx;ctx.clearRect(0,0,simW,simH);ctx.fillStyle='#fff';for(const s of shapes){const sx=s.x/CW*simW,sy=(1-s.y/CH)*simH,sw=s.w/CW*simW,sh=s.h/CH*simH;ctx.save();ctx.translate(sx,sy);ctx.rotate(-s.angle);drawShapePath(ctx,s.type,sw,sh,s.teeth,s.points);ctx.restore();}ctx.drawImage(drawnCanvas,0,0);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,barrierCanvas);}

// Read the fluid velocity at one world point by reading back a single pixel of
// the velocity texture. Used to push dynamic (non-fixed) shapes with the flow.
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
// CPU rigid-body step, run once per frame before the fluid step. Spin driven
// shapes rotate; dynamic shapes are pushed by the sampled fluid velocity (drag),
// gravity, and a torque from the left/right velocity difference, then bounced
// off walls. The final loops resolve shape-shape collisions (penetration
// pushout plus a restitution impulse). Fixed shapes and the dragged object skip.
function integrateShapes(){
  for(const s of shapes){if(s.spin!==0&&s!==dragObj)s.angle+=s.spin*deltaTime;}
  for(const e of emitters){if(e.spin!==0&&e!==dragObj)e.angle+=e.spin*deltaTime;}
  // Wander: add the rate of wander*sin(wt), so the angle swings round wherever
  // the angle slider or a drag left it.
  for(const e of emitters){if(e.wander>0&&e!==dragObj){e.wt+=e.wf*deltaTime;e.angle+=e.wander*e.wf*Math.cos(e.wt)*deltaTime;}}
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
  // Broad-phase by bounding radius, then resolve overlap and contact response.
  // REST=restitution, PAD/SKIN=contact margins, CD=contact damping.
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

// GL plumbing: compile a shader, link a program, cache uniform locations.
/* ═══ WEBGL ═══ */
function compS(t,s){const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh));throw new Error('Shader');}return sh;}
function mkP(v,f){const p=gl.createProgram();gl.attachShader(p,compS(gl.VERTEX_SHADER,v));gl.attachShader(p,compS(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Link');return p;}
function gU(p,ns){const u={};for(const n of ns)u[n]=gl.getUniformLocation(p,n);return u;}
// Build a ping-pong pair (DoubleFBO): two float textures with framebuffers, and
// read/write getters plus swap(). Each solver stage reads read and draws to
// write, then swaps, so the new state feeds the next stage.
function mkDF(w,h){const mk=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    const data=TEX_TYPE===gl.FLOAT?new Float32Array(w*h*4):TEX_TYPE===gl.HALF_FLOAT?new Uint16Array(w*h*4):new Uint8Array(w*h*4);
    gl.texImage2D(gl.TEXTURE_2D,0,TEX_FMT,w,h,0,gl.RGBA,TEX_TYPE,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);return{tex:t,fbo:f};};let a=mk(),b=mk();return{get read(){return a},get write(){return b},swap(){[a,b]=[b,a]}};}
// Build a single float texture + framebuffer (no ping-pong): used for
// divergence (dvF) and the stashed pre-diffusion velocity (u0F).
function mkF(w,h){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  const data=TEX_TYPE===gl.FLOAT?new Float32Array(w*h*4):TEX_TYPE===gl.HALF_FLOAT?new Uint16Array(w*h*4):new Uint8Array(w*h*4);
  gl.texImage2D(gl.TEXTURE_2D,0,TEX_FMT,w,h,0,gl.RGBA,TEX_TYPE,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,TEX_FILTER);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);return{tex:t,fbo:f};}
// The covering quad shared by every pass, and dq() to draw it once per pass.
const qVAO=gl.createVertexArray();gl.bindVertexArray(qVAO);const qb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,qb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);function dq(){gl.bindVertexArray(qVAO);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
// The shared vertex shader source.
const VS=RAW['shaders/quad.vert.glsl'];

// Where hardware cannot linearly filter floats, splice in a manual bilinear
// function and swap the sampling expressions the advect/display shaders use.
// These strings are interpolated into the shader source below.
// Manual bilinear interpolation for mobile GPUs without OES_texture_float_linear
const BILERP_GLSL=TEX_CAN_LINEAR?'':RAW['shaders/bilerp.frag.glsl'];
const SAMPLE_VEL=TEX_CAN_LINEAR?'texture(uVelocity,sp).xy':'bilerp(uVelocity,sp,uInvRes).xy';
const SAMPLE_DYE=TEX_CAN_LINEAR?'texture(uDye,sp)':'bilerp(uDye,sp,uInvRes)';

// advect.frag.glsl and display.frag.glsl are template literals: eval fills their
// placeholders (MAX_E, MAX_S, the sampling helpers) from the constants above.
const ADV_FS=eval('`'+RAW['shaders/advect.frag.glsl']+'`');

const DIV_FS=RAW['shaders/divergence.frag.glsl'];

const JAC_FS=RAW['shaders/jacobi.frag.glsl'];

const GRD_FS=RAW['shaders/gradient.frag.glsl'];

const DSP_FS=eval('`'+RAW['shaders/display.frag.glsl']+'`');

// One program per solver stage, each with its uniform locations cached:
//   aP advect (also injects forces and carries dye)   dP divergence
//   jP jacobi pressure solve   gP gradient subtract   rP display
const aP=mkP(VS,ADV_FS),aU=gU(aP,['uVelocity','uDye','uBarrier','uInvRes','uDt','uAspect','uMode','uGravity','uFade','uNumEmitters','uNumShapes',...Array.from({length:MAX_E},(_,i)=>[`uEmitA[${i}]`,`uEmitB[${i}]`,`uEmitC[${i}]`]).flat(),...Array.from({length:MAX_S},(_,i)=>`uShapeA[${i}]`)]);
const dP=mkP(VS,DIV_FS),dU=gU(dP,['uVelocity','uBarrier','uInvRes']);
const jP=mkP(VS,JAC_FS),jU=gU(jP,['uPressure','uDivergence','uBarrier','uInvRes']);
const gP=mkP(VS,GRD_FS),gUn=gU(gP,['uPressure','uVelocity','uBarrier','uInvRes']);
const rP=mkP(VS,DSP_FS),rU=gU(rP,['uVelocity','uDye','uBarrier','uGain','uBloom','uCmap']);

/* ═══ VISCOUS DIFFUSION ═══
   Implicit backward-Euler: (I - νΔt∇²)u = u*, Jacobi-solved.
   Unconditionally stable, well-conditioned (diagonal 1+4a dominates), so ~20 sweeps converge.
   Only runs when ν>0, so the default (ν=0) path is identical in cost to before. */
// Extra programs for the optional viscous solve: cP copies u* aside, fP is one
// implicit diffusion Jacobi sweep.
const COPY_FS=RAW['shaders/copy.frag.glsl'];
const DIFF_FS=RAW['shaders/diffuse.frag.glsl'];
const cP=mkP(VS,COPY_FS),cU=gU(cP,['uTex']);
const fP=mkP(VS,DIFF_FS),fU=gU(fP,['uVel','uVel0','uBarrier','uInvRes','uA']);
const DIFFUSE_ITERS=20;
// Vorticity confinement: kP writes the scalar curl into cuF, vP adds the force
// that turns the flow back round each swirl centre. Skipped when SIM.curl is 0.
const kP=mkP(VS,RAW['shaders/curl.frag.glsl']),kU=gU(kP,['uVelocity','uBarrier','uInvRes']);
const vP=mkP(VS,RAW['shaders/vorticity.frag.glsl']),vU=gU(vP,['uVelocity','uCurlTex','uBarrier','uInvRes','uCurl','uDt']);
// Splats: spP adds a batch of Gaussian splats to one field (velocity or dye).
const SPL_FS=eval('`'+RAW['shaders/splat.frag.glsl']+'`');
const spP=mkP(VS,SPL_FS),spU=gU(spP,['uTarget','uBarrier','uAspect','uKind','uCount',...Array.from({length:MAX_SPL},(_,i)=>[`uSplatP[${i}]`,`uSplatF[${i}]`,`uSplatC[${i}]`]).flat()]);

// The simulation textures: velocity, pressure, divergence, dye, and stashed u*.
let vF,pF,dvF,dyF,u0F,cuF;
// Allocate them at a grid resolution derived from the canvas aspect and a device
// scale, capped by maxSide. Also creates the barrier texture and the offscreen
// barrier canvases, and reports the grid size to the status bar.
function initFBOs(){const isMob=window.innerWidth<600;const scale=isMob?0.5:0.75;
  // MOBILE FIX: Maintain screen aspect ratio in sim grid.
  // Old code forced 384×384 square on portrait screens, distorting all shapes.
  const maxSide=isMob?384:1024;
  if(canvas.width>=canvas.height){simW=Math.min(Math.floor(canvas.width*scale),maxSide);simH=Math.max(64,Math.round(simW*canvas.height/canvas.width));}
  else{simH=Math.min(Math.floor(canvas.height*scale),maxSide);simW=Math.max(64,Math.round(simH*canvas.width/canvas.height));}
  simW=Math.max(simW,64);simH=Math.max(simH,64);vF=mkDF(simW,simH);pF=mkDF(simW,simH);dvF=mkF(simW,simH);dyF=mkDF(simW,simH);u0F=mkF(simW,simH);cuF=mkF(simW,simH);
  barrierTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,simW,simH,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);initBarrierCanvas();document.getElementById('st-res').textContent=simW+'×'+simH+(TEX_CAN_LINEAR?'':' [nearest]');}
// Match canvas backing size to the wrapper and reallocate the sim grid.
function resize(){const w=document.getElementById('canvas-wrap');CW=w.clientWidth;CH=w.clientHeight;if(CW<10||CH<10){CW=300;CH=300;}const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.floor(CW*dpr);canvas.height=Math.floor(CH*dpr);initFBOs();frame=0;}
if(window.ResizeObserver)new ResizeObserver(()=>resize()).observe(document.getElementById('canvas-wrap'));else window.addEventListener('resize',resize);

// One simulation step: the full Stam pipeline (advect → [diffuse] → advect dye →
// divergence → pressure jacobi → gradient subtract). Each stage is a quad draw
// into a framebuffer; ping-pong swaps make the output feed the next stage.
function step(){const inv=[1/simW,1/simH],asp=simW/simH;integrateShapes();
  // Re-raster the barrier if a shape moved or spun, so no-flow cells track them.
  let nb=barrierDirty;for(const s of shapes)if(s.spin!==0||!s.fixed){nb=true;break;}if(nb){renderBarrierCanvas();barrierDirty=false;}
  gl.viewport(0,0,simW,simH);
  // Stage 0 - splats: turn the live pointers into splats, then draw every
  // queued splat (pointer strokes, bursts) into vF and dyF.
  pointerSplats();flushSplats();
  // Stage 1 - advect velocity (uMode 0): semi-Lagrangian backtrace of vF, plus
  // emitter/mouse/gravity forces and shape solid-body velocity. Writes vF.write.
  gl.bindFramebuffer(gl.FRAMEBUFFER,vF.write.fbo);gl.useProgram(aP);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(aU.uVelocity,0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dyF.read.tex);gl.uniform1i(aU.uDye,1);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(aU.uBarrier,2);
  gl.uniform2f(aU.uInvRes,inv[0],inv[1]);gl.uniform1f(aU.uDt,deltaTime);gl.uniform1f(aU.uAspect,asp);gl.uniform1i(aU.uMode,0);
  gl.uniform1f(aU.uGravity,SIM.gravity?SIM.gravityStr:0);gl.uniform1f(aU.uFade,SIM.dyeFade);
  gl.uniform1i(aU.uNumEmitters,emitters.length);gl.uniform1i(aU.uNumShapes,shapes.length);
  // Pack each active emitter into three vec4 uniforms (position+direction,
  // strength/width/type, dye colour); direction depends on the emitter type.
  for(let i=0;i<MAX_E;i++){const e=emitters[i];if(e&&e.active){const ca=Math.cos(e.angle),sa=Math.sin(e.angle);let dx=ca,dy=-sa;const et=e.type==='jet'?0:e.type==='point'?1:2;if(e.type==='point'){dx=0;dy=0;}if(e.type==='vortex'){dx=-sa;dy=-ca;}gl.uniform4f(aU[`uEmitA[${i}]`],e.x/CW,1-e.y/CH,dx,dy);gl.uniform4f(aU[`uEmitB[${i}]`],e.strength*(e.mult||1),e.width,et,1);gl.uniform4f(aU[`uEmitC[${i}]`],e.dyeR,e.dyeG,e.dyeB,0);}else{gl.uniform4f(aU[`uEmitA[${i}]`],0,0,0,0);gl.uniform4f(aU[`uEmitB[${i}]`],0,0,0,0);gl.uniform4f(aU[`uEmitC[${i}]`],0,0,0,0);}}
  // Pack each shape's centre, spin, and radius so the advect shader can stamp
  // its rotational solid-body velocity into barrier cells.
  for(let i=0;i<MAX_S;i++){const s=shapes[i];if(s)gl.uniform4f(aU[`uShapeA[${i}]`],s.x/CW,1-s.y/CH,s.spin,Math.max(s.w,s.h)/2/CW);else gl.uniform4f(aU[`uShapeA[${i}]`],0,0,0,0);}
  dq();vF.swap();
  // Stage 2 - viscous diffusion (only when ν>0). Solve (I - νΔt∇²)u = u* by
  // Jacobi: stash u* in u0F as the fixed right-hand side, then sweep diffuse.
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
  // Stage 3 - advect dye (uMode 1): carry the colour field along the new
  // velocity, so the dye traces the flow. Writes dyF.write, then swap.
  gl.useProgram(aP);gl.bindFramebuffer(gl.FRAMEBUFFER,dyF.write.fbo);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(aU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dyF.read.tex);gl.uniform1i(aU.uDye,1);gl.uniform1i(aU.uMode,1);dq();dyF.swap();
  // Stage 3b - vorticity confinement (only when SIM.curl>0): curl of vF into
  // cuF, then add eps (N x w) dt to vF. Runs before the projection, so the
  // added force is made divergence-free with the rest of the velocity.
  if(SIM.curl>1e-3){
    gl.bindFramebuffer(gl.FRAMEBUFFER,cuF.fbo);gl.useProgram(kP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(kU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(kU.uBarrier,1);gl.uniform2f(kU.uInvRes,inv[0],inv[1]);dq();
    gl.bindFramebuffer(gl.FRAMEBUFFER,vF.write.fbo);gl.useProgram(vP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(vU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,cuF.tex);gl.uniform1i(vU.uCurlTex,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(vU.uBarrier,2);gl.uniform2f(vU.uInvRes,inv[0],inv[1]);gl.uniform1f(vU.uCurl,SIM.curl);gl.uniform1f(vU.uDt,deltaTime);dq();vF.swap();
  }
  // Stage 4 - divergence: measure ∇·u of the advected velocity into dvF (the
  // right-hand side of the pressure Poisson equation).
  gl.bindFramebuffer(gl.FRAMEBUFFER,dvF.fbo);gl.useProgram(dP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(dU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(dU.uBarrier,1);gl.uniform2f(dU.uInvRes,inv[0],inv[1]);dq();
  // Stage 5 - pressure Poisson solve: jacobiIters Jacobi sweeps, pF ping-ponging
  // against the fixed divergence, converging toward the pressure that will
  // cancel divergence.
  gl.useProgram(jP);for(let i=0;i<SIM.jacobiIters;i++){gl.bindFramebuffer(gl.FRAMEBUFFER,pF.write.fbo);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pF.read.tex);gl.uniform1i(jU.uPressure,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dvF.tex);gl.uniform1i(jU.uDivergence,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(jU.uBarrier,2);gl.uniform2f(jU.uInvRes,inv[0],inv[1]);dq();pF.swap();}
  // Stage 6 - gradient subtract (projection): u = u - ∇p, leaving the velocity
  // divergence-free (incompressible). Writes vF.write, then swap.
  gl.bindFramebuffer(gl.FRAMEBUFFER,vF.write.fbo);gl.useProgram(gP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pF.read.tex);gl.uniform1i(gUn.uPressure,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(gUn.uVelocity,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(gUn.uBarrier,2);gl.uniform2f(gUn.uInvRes,inv[0],inv[1]);dq();vF.swap();}

// Render the current velocity/dye/barrier to the screen with the chosen colormap
// and bloom, then draw the 2D overlay (icons, vectors, brush) on top.
function display(){
  if(barrierDirty){renderBarrierCanvas();barrierDirty=false;}
  gl.viewport(0,0,canvas.width,canvas.height);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(rP);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vF.read.tex);gl.uniform1i(rU.uVelocity,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,dyF.read.tex);gl.uniform1i(rU.uDye,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(rU.uBarrier,2);gl.uniform1f(rU.uGain,SIM.gain);gl.uniform1f(rU.uBloom,SIM.bloom);gl.uniform1i(rU.uCmap,SIM.cmap);dq();drawOverlays();}

// Splat queue. Each entry is {x, y (uv, y up), r (height units), m (0 push,
// 1 swirl, 2 dye only), fx, fy (cells/s, or swirl rate in fx), c (rgb)}.
// flushSplats() draws the queue in batches of MAX_SPL: one velocity pass and
// one dye pass per batch. The queue keeps at most 256 entries while paused.
/* ═══ SPLATS ═══ */
let splats=[];
function queueSplat(q){splats.push(q);if(splats.length>256)splats.splice(0,splats.length-256);}
function flushSplats(){if(!splats.length)return;gl.useProgram(spP);gl.uniform1f(spU.uAspect,simW/simH);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,barrierTex);gl.uniform1i(spU.uBarrier,1);
  for(let b=0;b<splats.length;b+=MAX_SPL){const n=Math.min(MAX_SPL,splats.length-b);
    for(let i=0;i<n;i++){const q=splats[b+i];gl.uniform4f(spU[`uSplatP[${i}]`],q.x,q.y,q.r,q.m);gl.uniform4f(spU[`uSplatF[${i}]`],q.fx,q.fy,0,0);gl.uniform4f(spU[`uSplatC[${i}]`],q.c[0],q.c[1],q.c[2],0);}
    gl.uniform1i(spU.uCount,n);
    for(const[kind,F]of[[0,vF],[1,dyF]]){gl.bindFramebuffer(gl.FRAMEBUFFER,F.write.fbo);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,F.read.tex);gl.uniform1i(spU.uTarget,0);gl.uniform1i(spU.uKind,kind);dq();F.swap();}}
  splats=[];}
// Queue one splat given in screen px, once per mirror copy. Copies turn round
// the canvas centre by 2 pi k / SIM.mirror; the force vector turns with them.
// fx, fy are screen px/s for a push, or the swirl rate for a swirl.
function mirrorSplat(sx,sy,r,m,fx,fy,c){const N=Math.max(1,SIM.mirror|0),cx=CW/2,cy=CH/2;
  for(let k=0;k<N;k++){const a=k/N*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),dx=sx-cx,dy=sy-cy;
    const x=cx+dx*ca-dy*sa,y=cy+dx*sa+dy*ca;if(x<0||y<0||x>CW||y>CH)continue;
    const vx=m===0?fx*ca-fy*sa:fx,vy=m===0?fx*sa+fy*ca:0;
    queueSplat({x:x/CW,y:1-y/CH,r,m,fx:m===0?vx/CW*simW:vx,fy:m===0?-vy/CH*simH:0,c});}}
// Turn each live pointer into splats for this step. A push follows the
// stroke from the last position to this one, with one splat per 0.6 radius
// (at most 8), so a fast stroke leaves no gaps. A swirl and an ink stamp
// apply each step while held. A new press first drops one ink blob.
function pointerSplats(){if(!pointers.size)return;const dt=Math.max(deltaTime,1e-3),rpx=SIM.splatR*CH;
  for(const P of pointers.values()){const tool=P.swirl?'swirl':SIM.tool;
    if(SIM.rainbow)P.hue+=dt*90;const c0=SIM.rainbow?saverHsl(P.hue,0.9,0.55):SIM.inkColor,ink=SIM.ink*0.25,col=k=>[c0[0]*k,c0[1]*k,c0[2]*k];
    if(P.fresh){P.fresh=false;mirrorSplat(P.x,P.y,SIM.splatR*1.2,2,0,0,col(ink*2));}
    const dx=P.x-P.px,dy=P.y-P.py,dist=Math.hypot(dx,dy);
    if(tool==='swirl'){mirrorSplat(P.x,P.y,SIM.splatR*1.8,1,P.sign*120*SIM.force*dt,0,col(ink*0.15));}
    else if(tool==='ink'){mirrorSplat(P.x,P.y,SIM.splatR,2,0,0,col(ink*(dist>0.5?0.8:0.3)));}
    if(dist>0.5){const n=Math.min(8,Math.max(1,Math.ceil(dist/(rpx*0.6))));
      let vx=dx/dt*SIM.force*0.4,vy=dy/dt*SIM.force*0.4;const vm=Math.hypot(vx,vy),cap=4000/simW*CW;if(vm>cap){vx*=cap/vm;vy*=cap/vm;}
      for(let i=1;i<=n;i++){const x=P.px+dx*i/n,y=P.py+dy*i/n;
        if(tool==='push')mirrorSplat(x,y,SIM.splatR,0,vx,vy,col(ink*0.8/Math.sqrt(n)));
        else if(tool==='ink'&&i<n)mirrorSplat(x,y,SIM.splatR,2,0,0,col(ink*0.8/Math.sqrt(n)));}}
    P.px=P.x;P.py=P.y;}}

// The 2D overlay canvas sits above the WebGL canvas and draws object icons,
// selection highlights, the vector field, and the draw brush.
/* ═══ OVERLAY ═══ */
let overlayCanvas,overlayCtx;
// Create the overlay canvas and add it over the sim canvas.
function initOverlay(){overlayCanvas=document.createElement('canvas');overlayCanvas.id='display-canvas';overlayCanvas.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;cursor:crosshair;touch-action:none';document.getElementById('canvas-wrap').appendChild(overlayCanvas);overlayCtx=overlayCanvas.getContext('2d');}
// Redraw the overlay each frame: blit the WebGL frame, then draw emitter and
// shape icons with their selection state and spin arcs, then optionally the
// vector field and the brush cursor.
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

  // Vector field overlay: read back the whole velocity texture once, then draw a
  // little arrow per grid cell showing local flow direction and speed.
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

  // Pointer rings: one per live pointer and mirror copy, at the splat radius.
  if(pointers.size&&!SIM.drawMode&&!SIM.eraseMode){const N=Math.max(1,SIM.mirror|0),cx=CW/2,cy=CH/2,rr=SIM.splatR*CH*(SIM.tool==='swirl'?1.8:1);ctx.strokeStyle='rgba(200,220,255,0.35)';ctx.lineWidth=1;
    for(const P of pointers.values())for(let k=0;k<N;k++){const a=k/N*Math.PI*2,dx=P.x-cx,dy=P.y-cy;ctx.beginPath();ctx.arc(cx+dx*Math.cos(a)-dy*Math.sin(a),cy+dx*Math.sin(a)+dy*Math.cos(a),rr,0,Math.PI*2);ctx.stroke();}}
  if(SIM.drawMode||SIM.eraseMode){ctx.strokeStyle=SIM.eraseMode?'rgba(255,80,80,0.5)':'rgba(150,200,255,0.5)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(mouse.screenX,mouse.screenY,SIM.brushSize/2,0,Math.PI*2);ctx.stroke();}}

// Pointer state and interaction, by Pointer Events, so each finger of a
// multi-touch is its own pointer. Depending on mode, a press drags or turns
// an object (one pointer at a time), paints the barrier brush (primary
// pointer only), or adds a stirring pointer to the pointers map.
/* ═══ INPUT ═══ */
let mouse={screenX:0,screenY:0,down:false};
let dragObj=null,dragPid=null,dragOffX=0,dragOffY=0,rotating=false;
// Live stirring pointers by pointerId: {x, y, px, py (screen px), swirl (right
// button), sign, hue, fresh}. pointerSplats() reads and advances them.
const pointers=new Map();let inkHue=Math.random()*360;

// Pointer position in canvas-local pixels.
function gp(e){const r=document.getElementById('canvas-wrap').getBoundingClientRect();return{sx:e.clientX-r.left,sy:e.clientY-r.top};}
// Hit-test emitters then shapes (topmost first) at a screen point.
function hitObj(sx,sy){for(let i=emitters.length-1;i>=0;i--){const e=emitters[i];if(Math.sqrt((sx-e.x)**2+(sy-e.y)**2)<e.width*CH+15)return{obj:e,type:'emitter'};}
  for(let i=shapes.length-1;i>=0;i--){const s=shapes[i];const ca=Math.cos(-s.angle),sa=Math.sin(-s.angle);const dx=sx-s.x,dy=sy-s.y;if(Math.abs(dx*ca-dy*sa)<s.w/2+12&&Math.abs(dx*sa+dy*ca)<s.h/2+12)return{obj:s,type:'shape'};}return null;}

// Press: paint if in draw/erase mode; else grab an object under the pointer
// (shift to turn it); else start a stirring pointer (right button = swirl the
// other way round, whatever the tool).
function onDown(e){e.preventDefault();const{sx,sy}=gp(e);if(e.isPrimary!==false){mouse.screenX=sx;mouse.screenY=sy;}
  try{overlayCanvas.setPointerCapture(e.pointerId);}catch(_){}
  if(SIM.drawMode||SIM.eraseMode){if(e.isPrimary!==false){mouse.down=true;drawBrush(sx,sy);}return;}
  const hit=dragObj?null:hitObj(sx,sy);
  if(hit){dragObj=hit.obj;dragPid=e.pointerId;dragOffX=hit.obj.x-sx;dragOffY=hit.obj.y-sy;rotating=e.shiftKey;SIM.selectedId=hit.obj.id;SIM.selectedType=hit.type;rebuildList();return;}
  inkHue=(inkHue+47)%360;
  pointers.set(e.pointerId,{x:sx,y:sy,px:sx,py:sy,swirl:e.button===2,sign:e.button===2?-1:1,hue:inkHue,fresh:true});
  if(SIM.selectedId!==-1){SIM.selectedId=-1;rebuildList();}}
// Move: continue painting, drag/turn the held object, or move a stirring pointer.
function onMove(e){const{sx,sy}=gp(e);if(e.isPrimary!==false){mouse.screenX=sx;mouse.screenY=sy;}
  if(SIM.drawMode||SIM.eraseMode){if(mouse.down&&e.isPrimary!==false)drawBrush(sx,sy);return;}
  if(dragObj&&e.pointerId===dragPid){e.preventDefault();if(rotating)dragObj.angle=Math.atan2(sy-dragObj.y,sx-dragObj.x);else{dragObj.x=sx+dragOffX;dragObj.y=sy+dragOffY;}barrierDirty=true;return;}
  const P=pointers.get(e.pointerId);if(P){P.x=sx;P.y=sy;}}
// Release: drop the held object (zeroing its velocity) or end that pointer's stir.
function onUp(e){if(dragObj&&e.pointerId===dragPid){dragObj.vx=0;dragObj.vy=0;dragObj=null;dragPid=null;rotating=false;}
  pointers.delete(e.pointerId);if(e.isPrimary!==false)mouse.down=false;}

// Barrier brush: stamp (or erase) a filled circle into the drawn-wall canvas at
// sim resolution and flag the barrier for re-upload.
/* ═══ DRAW ═══ */
function drawBrush(sx,sy){const bx=sx/CW*simW,by=(1-sy/CH)*simH,r=SIM.brushSize/CW*simW;
  if(SIM.eraseMode){drawnCtx.globalCompositeOperation='destination-out';drawnCtx.beginPath();drawnCtx.arc(bx,by,r,0,Math.PI*2);drawnCtx.fill();drawnCtx.globalCompositeOperation='source-over';}
  else{drawnCtx.fillStyle='#fff';drawnCtx.beginPath();drawnCtx.arc(bx,by,r,0,Math.PI*2);drawnCtx.fill();}barrierDirty=true;}
// Erase all drawn walls.
function clearDrawn(){drawnCtx.clearRect(0,0,simW,simH);barrierDirty=true;}
// Draw/erase mode toggles (mutually exclusive).
function toggleDraw(){SIM.drawMode=!SIM.drawMode;if(SIM.drawMode)SIM.eraseMode=false;updD();}
function toggleErase(){SIM.eraseMode=!SIM.eraseMode;if(SIM.eraseMode)SIM.drawMode=false;updD();}
// Reflect the current mode in the buttons, cursor, and status bar.
function updD(){document.getElementById('tog-draw').className='tog-btn '+(SIM.drawMode?'on':'off');document.getElementById('tog-erase').className='tog-btn '+(SIM.eraseMode?'on':'off');if(overlayCanvas)overlayCanvas.style.cursor=(SIM.drawMode||SIM.eraseMode)?'none':'crosshair';document.getElementById('st-mode').textContent=SIM.drawMode?'draw':SIM.eraseMode?'erase':SIM.tool+(SIM.mirror>1?' ×'+SIM.mirror:'');}
// Pointer tool, mirror count and ink colour. The tool and mirror buttons
// carry data-tool and data-mirror; picking a colour turns rainbow ink off.
function setTool(t){SIM.tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));updD();}
function setMirror(n){SIM.mirror=n;document.querySelectorAll('[data-mirror]').forEach(b=>b.classList.toggle('active',+b.dataset.mirror===n));updD();}
function toggleRainbow(){SIM.rainbow=!SIM.rainbow;document.getElementById('tog-rainbow').className='tog-btn '+(SIM.rainbow?'on':'off');}
function setInkColor(hex){SIM.inkColor=[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];if(SIM.rainbow)toggleRainbow();}

// Paint a range input's filled portion via the --pct CSS variable.
/* ═══ UI ═══ */
function sg(el){el.style.setProperty('--pct',((el.value-el.min)/(el.max-el.min)*100)+'%');}
document.querySelectorAll('#panel input[type=range]').forEach(sg);

// Bind a per-object slider (in an object card) to obj[prop], updating its readout
// and, for shapes, flagging the barrier dirty so the change re-rasters.
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

// Rebuild the object panel: one card per emitter and shape, sorted by id, each
// with type-specific sliders (strength/width, size, spin, wander, colour) and
// its randomize/duplicate/delete/fixed controls wired up.
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

    let head=`<div class="obj-card-head"><span class="obj-card-name">${isE?'Emitter':'Shape'} · ${obj.type}</span><button class="obj-card-dup" style="background:transparent;border:none;color:var(--text-faint);cursor:pointer;font-size:0.7rem;padding:2px 4px" title="Duplicate">⧉</button><button class="obj-card-rnd" style="background:transparent;border:none;color:var(--text-faint);cursor:pointer;font-size:0.8rem;padding:2px 4px" title="Randomize">⚄</button><button class="obj-card-del">✕</button></div>`;
    let rows='';
    if(isE){
      const curMult=obj.mult||1;
      rows=`<div class="mag-row"><span class="mag-row-lbl">Strength</span><input type="range" data-p="strength" min="1" max="1000" value="${obj.strength}" step="5"><span class="val">${obj.strength}</span></div>`
        +`<div style="display:flex;gap:2px;margin:2px 0 6px;flex-wrap:wrap">`
        +[1,10,100,1e3,1e4,1e5].map(m=>`<button class="sim-btn${curMult===m?' active':''}" data-mult="${m}" style="flex:1;padding:4px 2px;font-size:.7rem;min-width:0">×${m>=1000?(m/1000)+'K':m}</button>`).join('')
        +`</div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Width</span><input type="range" data-p="width" min="0.01" max="0.35" value="${obj.width}" step="0.005"><span class="val">${obj.width.toFixed(2)}</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Angle</span><input type="range" data-p="angle" min="-3.14159" max="3.14159" value="${obj.angle}" step="0.05"><span class="val">${(obj.angle*180/Math.PI).toFixed(0)}°</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Spin</span><input type="range" data-p="spin" min="-12" max="12" value="${obj.spin}" step="0.25"><span class="val">${obj.spin.toFixed(1)}</span></div>`
        +`<div class="mag-row"><span class="mag-row-lbl">Wander</span><input type="range" data-p="wander" min="0" max="1.5" value="${obj.wander||0}" step="0.05"><span class="val">${(obj.wander||0).toFixed(2)}</span></div>`
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
      rows+=`<button class="tog-btn ${obj.fixed?'off':'on'}">${obj.fixed?'Fixed':'Dynamic'}</button>`;
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

    const rndBtn=c.querySelector('.obj-card-rnd');
    if(rndBtn) rndBtn.addEventListener('click', function(){randomizeObj(capturedId,capturedKind);});

    const dupBtn=c.querySelector('.obj-card-dup');
    if(dupBtn) dupBtn.addEventListener('click', function(){duplicateObj(capturedId,capturedKind);});

    const togBtn=c.querySelector('.tog-btn');
    if(togBtn) togBtn.addEventListener('click', function(){toggleFixed(capturedId);});
  }
  document.getElementById('st-obj').textContent=(emitters.length+shapes.length)+' objects';
}
// Flip a shape between fixed (immovable barrier) and dynamic (fluid-driven).
function toggleFixed(id){const s=shapes.find(o=>o.id===id);if(!s)return;s.fixed=!s.fixed;s.vx=0;s.vy=0;s.va=0;rebuildList();}
// Find a free spot for a new object by spiralling out from the centre.
function findSpot(){const all=[...emitters,...shapes];for(let ring=0;ring<8;ring++){const r=ring*60,steps=Math.max(1,ring*6);for(let s=0;s<steps;s++){const a=s/steps*Math.PI*2,tx=CW/2+Math.cos(a)*r,ty=CH/2+Math.sin(a)*r;let ok=true;for(const o of all)if((tx-o.x)**2+(ty-o.y)**2<3600){ok=false;break;}if(ok)return{x:Math.max(40,Math.min(CW-40,tx)),y:Math.max(40,Math.min(CH-40,ty))};}}return{x:CW/2,y:CH/2};}
// Add / remove / duplicate objects, respecting the MAX_E / MAX_S caps.
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
// Play/pause, reset (reallocate the grid, keep objects), and clear everything.
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'Play':'Pause';b.classList.toggle('active',SIM.playing);}
function resetSim(){frame=0;initFBOs();barrierDirty=true;}
function clearAll(){emitters=[];shapes=[];SIM.selectedId=-1;if(drawnCtx)drawnCtx.clearRect(0,0,simW,simH);barrierDirty=true;resetSim();rebuildList();}

// Named demo scenes: wind tunnel (rainbow jets past a disc), Von Kármán vortex
// street, a spinning propeller, and colliding jets.
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

// Random scenes. RND holds the generator settings: layout, palette scheme,
// emitter and shape counts, and chaos (0..1). Chaos raises the share of
// spinning, wandering and dynamic objects and widens every random range.
// splash() fires dye bursts; RND.auto fires them by itself every 0.7-2.2 s.
/* ═══ RANDOMIZER ═══ */
const RND={layout:'any',palette:'any',emitters:4,shapes:8,chaos:0.5,auto:false,autoT:0};
const RND_LAYOUTS=['scatter','ring','crossfire','mirror','rain','whirlpool'];
const RND_SCHEMES=['analogous','complement','triad','rainbow','mono'];
// n dye colours (rgb 0..1) of one scheme round a random base hue.
function rndColours(n,scheme){const r=Math.random,base=r()*360,sc=scheme==='any'?RND_SCHEMES[Math.floor(r()*RND_SCHEMES.length)]:scheme,out=[];
  for(let i=0;i<n;i++){const f=n>1?i/(n-1):0.5;let h=base,l=0.55;
    if(sc==='analogous')h=base+(f-0.5)*80;else if(sc==='complement')h=base+(i%2)*180+(r()-0.5)*20;else if(sc==='triad')h=base+(i%3)*120+(r()-0.5)*16;else if(sc==='rainbow')h=base+i/n*360;else{h=base+(r()-0.5)*14;l=0.35+0.3*f;}
    out.push(saverHsl(h,0.75+r()*0.2,l));}
  return out;}
// Random strength, width, spin and wander for an emitter of its type.
function rndEmitterParams(e,ch){const r=Math.random;
  if(e.type==='jet'){e.strength=Math.round((60+r()*200)*(0.7+ch*0.6));e.width=+(0.015+r()*(0.03+ch*0.05)).toFixed(3);}
  else if(e.type==='vortex'){e.strength=Math.round(40+r()*(80+ch*120));e.width=+(0.04+r()*0.08).toFixed(3);}
  else{e.strength=Math.round(60+r()*100);e.width=+(0.025+r()*0.04).toFixed(3);}
  e.mult=1;e.spin=e.type==='jet'&&r()<ch*0.3?(r()<0.5?-1:1)*Math.round((0.3+r()*1.5)*4)/4:0;
  e.wander=r()<0.25+ch*0.6?Math.round((0.15+r()*(0.2+ch*0.8))*20)/20:0;e.wf=0.3+r()*0.9;e.wt=r()*6.283;}
// Random size, angle, spin, teeth/points and fixed/dynamic for a shape.
// scale shrinks the size when many shapes share the canvas.
function rndShapeParams(s,ch,scale=1){const r=Math.random,sz=Math.min(CW,CH)*(0.07+r()*0.1)*scale;
  s.w=sz;s.h=sz;if(s.type==='rect'){s.w=sz*(1+r()*1.5);s.h=sz*(0.2+r()*0.4);}else if(s.type==='airfoil'){s.w=sz*2.2;s.h=sz*0.5;}else if(s.type==='wedge'){s.w=sz*1.1;s.h=sz*0.9;}else if(s.type==='tesla'){s.w=sz*2.4;s.h=sz*0.9;}
  s.w=Math.round(Math.max(10,Math.min(250,s.w)));s.h=Math.round(Math.max(10,Math.min(250,s.h)));
  s.angle=(r()-0.5)*6.283;s.teeth=6+Math.floor(r()*11);s.points=3+Math.floor(r()*6);
  const spinny=s.type==='gear'||s.type==='star'||s.type==='rect';s.spin=r()<ch*(spinny?0.7:0.25)?(r()<0.5?-1:1)*Math.round((0.4+r()*2.2)*4)/4:0;
  s.fixed=!(s.spin===0&&r()<ch*0.4);s.vx=s.vy=s.va=0;}
// Build a new random scene from RND. Layouts:
//   scatter    emitters of any type anywhere, any angle
//   ring       jets on a ring, all pushing round it one way
//   crossfire  jets on the edges, aimed near the centre
//   mirror     jet pairs mirrored left/right, shapes on the centre line
//   rain       jets from the top and bottom edges, pushing across
//   whirlpool  one big vortex fed by jets aimed round it
// Shapes go where no other object is (30 tries), at most 2 of them dynamic,
// because each dynamic shape reads the velocity back every frame.
function randomScene(){const r=Math.random,ch=RND.chaos,n=Math.max(1,Math.min(MAX_E,RND.emitters|0)),
    lay=RND.layout==='any'?RND_LAYOUTS[Math.floor(r()*RND_LAYOUTS.length)]:RND.layout,cols=rndColours(n,RND.palette),hand=r()<0.5?-1:1,
    cx=CW/2,cy=CH/2,R=Math.min(CW,CH),M=R*0.05,jit=()=>(r()-0.5)*ch;
  clearAll();
  const add=(type,x,y,a,i)=>{if(emitters.length>=MAX_E)return null;const e=createEmitter(type,Math.max(M,Math.min(CW-M,x)),Math.max(M,Math.min(CH-M,y)));
    rndEmitterParams(e,ch);e.angle=Math.atan2(Math.sin(a),Math.cos(a));const c=cols[i%cols.length];e.dyeR=c[0];e.dyeG=c[1];e.dyeB=c[2];emitters.push(e);return e;};
  const pick=()=>{const q=r();return q<0.7-ch*0.2?'jet':q<0.93?'vortex':'point';};
  if(lay==='scatter'){for(let i=0;i<n;i++)add(pick(),CW*(0.1+r()*0.8),CH*(0.1+r()*0.8),r()*6.283,i);}
  else if(lay==='ring'){const rad=R*(0.22+r()*0.14),ph0=r()*6.283;for(let i=0;i<n;i++){const ph=ph0+i/n*6.283+jit()*0.6;add('jet',cx+Math.cos(ph)*rad,cy+Math.sin(ph)*rad,ph+hand*Math.PI/2+jit()*1.2,i);}}
  else if(lay==='crossfire'){for(let i=0;i<n;i++){const ed=Math.floor(r()*4),u=0.15+r()*0.7;let x,y;if(ed===0){x=M;y=CH*u;}else if(ed===1){x=CW-M;y=CH*u;}else if(ed===2){x=CW*u;y=M;}else{x=CW*u;y=CH-M;}
    const tx=cx+jit()*R*0.5,ty=cy+jit()*R*0.5;add('jet',x,y,Math.atan2(ty-y,tx-x)+hand*(0.1+ch*0.4)*r(),i);}}
  else if(lay==='mirror'){for(let i=0;emitters.length<n;i++){const x=CW*(0.06+r()*0.3),y=CH*(0.15+r()*0.7),a=(r()-0.5)*(0.5+ch*1.6),e=add('jet',x,y,a,i);if(!e||emitters.length>=n)break;
    const m=add('jet',CW-x,y,Math.PI-a,i);if(m){m.strength=e.strength;m.width=e.width;m.spin=-e.spin;m.wander=e.wander;m.wf=e.wf;m.wt=e.wt+Math.PI;}}}
  else if(lay==='rain'){for(let i=0;i<n;i++){const up=ch>0.6?r()<0.5:i%2===0,x=CW*(0.08+0.84*(i+0.5)/n)+jit()*CW*0.08;add('jet',x,up?CH-M:M,(up?-1:1)*Math.PI/2+jit()*0.8,i);}}
  else{const v=add('vortex',cx+jit()*R*0.2,cy+jit()*R*0.2,0,0);if(v){v.width=+(0.12+r()*0.12).toFixed(3);v.strength=Math.round(80+r()*120);}
    for(let i=1;i<n;i++){const ph=r()*6.283,rad=R*(0.3+r()*0.15),x=cx+Math.cos(ph)*rad*CW/R*0.9,y=cy+Math.sin(ph)*rad;add('jet',x,y,ph+hand*(Math.PI/2+0.3)+jit()*0.6,i);}}
  // Shapes spread over the whole canvas, every type equally likely. The gap
  // between objects and the shape size both shrink as the count grows. In
  // the mirror layout shapes come in left/right pairs (angle pi - a).
  const ST=['circle','rect','airfoil','wedge','gear','star','tesla'],ns=Math.min(MAX_S,RND.shapes|0),
    gap=Math.sqrt(CW*CH/Math.max(1,ns+emitters.length))*0.6,scale=1/Math.sqrt(Math.max(1,ns/4));let dyn=0;
  for(let i=0;i<ns;i++){const t=ST[Math.floor(r()*ST.length)],pair=lay==='mirror'&&i+1<ns;let x=cx,y=cy;
    for(let k=0;k<40;k++){x=lay==='mirror'?(pair?CW*(0.1+r()*0.32):cx):CW*(0.08+r()*0.84);y=CH*(0.1+r()*0.8);if([...emitters,...shapes].every(o=>(o.x-x)**2+(o.y-y)**2>gap*gap))break;}
    const s=createShape(t,x,y);rndShapeParams(s,ch,scale);
    if(lay==='mirror'){s.spin=0;s.fixed=true;if(pair){const m={...s,id:nextId++,x:CW-x,angle:Math.PI-s.angle};shapes.push(s,m);i++;continue;}s.angle=Math.PI/2;}
    if(!s.fixed&&dyn>=2)s.fixed=true;if(!s.fixed)dyn++;shapes.push(s);}
  SIM.selectedId=-1;barrierDirty=true;rebuildList();document.getElementById('st-mode').textContent='scene '+lay;}
// Fire n dye bursts: random place, direction, speed and radius, colours of
// the RND palette. Mirror copies apply, as for a pointer stroke.
function splash(n){const r=Math.random,cols=rndColours(Math.max(2,n),RND.palette);
  for(let i=0;i<n;i++){const a=r()*6.283,v=(0.8+r()*1.6)*CH,c=cols[i%cols.length],k=0.5+r()*0.4;
    mirrorSplat(CW*(0.1+r()*0.8),CH*(0.1+r()*0.8),0.025+r()*0.035,0,Math.cos(a)*v,Math.sin(a)*v,[c[0]*k,c[1]*k,c[2]*k]);}}
// Recolour every emitter with a fresh palette.
function shuffleColours(){const cols=rndColours(emitters.length,RND.palette);emitters.forEach((e,i)=>{const c=cols[i];e.dyeR=c[0];e.dyeG=c[1];e.dyeB=c[2];});rebuildList();}
// The per-card dice: new random parameters, keeping the object's place.
function randomizeObj(id,kind){if(kind==='emitter'){const e=emitters.find(o=>o.id===id);if(!e)return;rndEmitterParams(e,RND.chaos);e.angle=(Math.random()-0.5)*6.283;const c=rndColours(1,'any')[0];e.dyeR=c[0];e.dyeG=c[1];e.dyeB=c[2];}
  else{const s=shapes.find(o=>o.id===id);if(!s)return;rndShapeParams(s,RND.chaos);if(!s.fixed&&shapes.filter(o=>!o.fixed).length>2)s.fixed=true;barrierDirty=true;}
  rebuildList();}
function toggleAutoSplash(on){RND.auto=on===undefined?!RND.auto:on;RND.autoT=0;const b=document.getElementById('tog-auto');b.className='tog-btn '+(RND.auto?'on':'off');b.textContent=RND.auto?'Auto splash on':'Auto splash off';}
// Auto splash timer, run from loop() while playing.
function autoSplash(){if(!RND.auto)return;RND.autoT-=deltaTime;if(RND.autoT<=0){RND.autoT=0.7+Math.random()*1.5;splash(1+Math.floor(Math.random()*3));}}
// Keys: N = new scene, Space = splash. Off while typing in a field or in the saver.
document.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey||document.documentElement.classList.contains('saver'))return;const t=e.target&&e.target.tagName;if(t==='INPUT'||t==='SELECT'||t==='TEXTAREA')return;
  if(e.key===' '){e.preventDefault();splash(6);}else if(e.key==='n'||e.key==='N')randomScene();});

// Main loop: clamp the timestep (so a stall cannot blow up the solver), step the
// simulation when playing, always display, and update the FPS/frame readouts.
function loop(now){requestAnimationFrame(loop);deltaTime=Math.min((now-lastTime)/1000,.033);lastTime=now;fpsAccum+=deltaTime;fpsCount++;
  if(fpsAccum>=.5){document.getElementById('st-fps').textContent=Math.round(fpsCount/fpsAccum)+' fps';fpsAccum=0;fpsCount=0;}
  if(SIM.playing){autoSplash();step();frame++;}display();document.getElementById('st-frame').textContent='frame '+frame;}

// Boot: create the overlay, wire pointer/touch events, size everything, draw the
// colormap previews, then build a random scene (randomScene) and start the loop. The last
// line exposes the handlers the inline HTML onclick attributes call.
initOverlay();
overlayCanvas.addEventListener('contextmenu',e=>e.preventDefault());
overlayCanvas.addEventListener('pointerdown',onDown);overlayCanvas.addEventListener('pointermove',onMove);overlayCanvas.addEventListener('pointerup',onUp);overlayCanvas.addEventListener('pointercancel',onUp);
resize();renderCmapPreviews();
setTimeout(()=>{randomScene();requestAnimationFrame(loop);},60);
window.SIM=SIM;window.sg=sg;window.setCmap=setCmap;window.addEmitter=addEmitter;window.addShape=addShape;window.toggleDraw=toggleDraw;window.toggleErase=toggleErase;window.clearDrawn=clearDrawn;window.preset=preset;window.togglePlay=togglePlay;window.resetSim=resetSim;window.clearAll=clearAll;window.setTool=setTool;window.setMirror=setMirror;window.toggleRainbow=toggleRainbow;window.setInkColor=setInkColor;window.RND=RND;window.randomScene=randomScene;window.splash=splash;window.shuffleColours=shuffleColours;window.toggleAutoSplash=toggleAutoSplash;
// Read-only test hook: the live object lists and the splat queue length.
window.__fluidlab={get emitters(){return emitters},get shapes(){return shapes},get splats(){return splats.length},get pointers(){return pointers.size}};
// Screensaver hook for the shell (lib/screensaver.js). enter() hides the GUI and
// the outline overlay, makes #canvas-wrap fill the window (resize() then sizes
// the buffer), and starts a director that opts.seed drives. A prewarm runs three
// extra solver steps per frame for 2.4 s, before the recording starts.
//
//   seed ─▶ rng ─▶ scene (crossfire | carousel | wake | fountain)
//                  palette (base hue + scheme)   obstacle (some scenes)
//   director tick (each frame, own rAF):
//     slot actor: fade in ─▶ live (angle, place, strength drift) ─▶ fade out
//                 at fade-out start, the slot spawns its next actor (crossfade)
//     hue drift: the palette turns slowly through the dwell
//
// The fade scales both the dye colour and the push of an emitter, so a jet
// eases in and out with no step. calm (0..1, 1 = slowest) sets rate, the speed
// of every drift, the actor life and the fade time. The full window needs more
// push than the panel view, so the strength multiplier is 4 at calm 0 and 2.4
// at calm 1. A scene has 2 or 3 slots (wake 1 or 2), so with the crossfade at
// most 6 emitters push at one time. The palette has two hues, and the hue
// drifts 0.3 degrees per second times rate. The saver viscosity is SAVER_NU.
// The saver turns vorticity confinement off (it would undo the calm of nu) and
// keeps the dye fade at 0.997. exit() stops the director and puts back the GUI,
// nu 0, the confinement and fade slider values, and a new random scene.
let saverRun=null;
function saverRng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function saverHsl(h,s,l){h=((h%360)+360)%360/360;const f=n=>{const k=(n+h*12)%12,a=s*Math.min(l,1-l);return l-a*Math.max(-1,Math.min(k-3,9-k,1));};return[f(0),f(8),f(4)];}
const SAVER_SCENES=['crossfire','carousel','wake','fountain'];
// The saver viscosity. With nu 0 the full window breaks into fine eddies of
// every size. nu 4 (a = nu dt = 0.07 cells^2 per step) keeps the large vortices.
const SAVER_NU=4;
// Make one actor for slot i of the scene: a jet (or a vortex) with a base place,
// a base angle, drift amplitudes and phases, a hue and a life.
function saverSpawn(R,i,now){const sc=R.scene,r=R.rng,M=0.04;let x,y,a,type='jet',wob=0.06+r()*0.12,str=70+r()*50,w=0.025+r()*0.03;
  const aim=(px,py)=>Math.atan2(py-y,px-x);
  if(sc==='crossfire'){const ed=Math.floor(r()*4),u=0.15+r()*0.7;
    if(ed===0){x=M;y=u;}else if(ed===1){x=1-M;y=u;}else if(ed===2){x=u;y=M;}else{x=u;y=1-M;}
    a=aim(0.5,0.5)+R.hand*(0.35+r()*0.25);}
  else if(sc==='carousel'){const ph=R.ring+i/R.slots*Math.PI*2+(r()-0.5)*0.5,rad=0.22+r()*0.12;
    x=0.5+Math.cos(ph)*rad*R.ch/R.cw;y=0.5+Math.sin(ph)*rad;a=ph+R.hand*(Math.PI/2+0.15+r()*0.3);str*=0.8;
    if(r()<0.15){type='vortex';w=0.05+r()*0.04;str=40+r()*40;}}
  else if(sc==='wake'){if(i===0){x=M;y=0.5+(r()-0.5)*0.3;a=(r()-0.5)*0.3;w=0.12+r()*0.12;str=70+r()*40;wob=0.08+r()*0.1;}
    else{const top=r()<0.5;x=0.15+r()*0.6;y=top?M:1-M;a=(top?1:-1)*(Math.PI/2-0.4-r()*0.5);str*=0.5;}}
  else{const up=(i+R.flip)%2===0;x=0.1+0.8*(i+0.2+0.6*r())/R.slots;y=up?1-M:M;a=(up?-1:1)*Math.PI/2+(r()-0.5)*0.5;wob=0.1+r()*0.12;str*=0.8;}
  if(type==='jet'&&r()<0.06&&sc!=='wake'){type='vortex';w=0.05+r()*0.05;str=40+r()*40;x=0.2+r()*0.6;y=0.2+r()*0.6;}
  const e=createEmitter(type,x*R.cw,y*R.ch);e.angle=a;e.strength=str;e.width=w;e.dyeR=e.dyeG=e.dyeB=0;e.mult=0;
  const life=(18+r()*14)/Math.sqrt(R.rate),fade=Math.min(life*0.3,6/Math.sqrt(R.rate));
  return{e,bx:x,by:y,ba:a,wob,str,w:(0.04+r()*0.05)*R.rate,ph:r()*6.283,pd:(0.008+r()*0.015),
    hue:R.hues[i%R.hues.length]+(r()-0.5)*12,sat:0.6+r()*0.25,lit:0.4+r()*0.08,birth:now,life,fade,next:false,slot:i};}
function saverStart(opts){const calm=Math.max(0,Math.min(1,+opts.calm||0));let seed=opts.seed;if(!Number.isFinite(+seed))seed=Math.floor(Math.random()*4294967296);
  const rng=saverRng(+seed),rate=1-0.6*calm,k=4*(1-0.4*calm);
  const R={rng,rate,k,cw:CW,ch:CH,scene:SAVER_SCENES[Math.floor(rng()*SAVER_SCENES.length)],ring:rng()*6.283,hand:rng()<0.5?-1:1,actors:[],raf:0,t0:performance.now(),hueShift:0};
  const base=rng()*360,scheme=Math.floor(rng()*3);R.hues=scheme===0?[base,base+30]:scheme===1?[base,base+150]:[base,base+180];
  R.flip=rng()<0.5?0:1;R.slots=R.scene==='wake'?1+Math.floor(rng()*2):2+Math.floor(rng()*2);
  clearAll();SIM.selectedId=-1;
  if(R.scene==='wake'||(R.scene==='crossfire'&&rng()<0.5)){const types=['circle','airfoil','star','gear','circle'],t=types[Math.floor(rng()*types.length)];
    const s=createShape(t,CW*(R.scene==='wake'?0.28+rng()*0.1:0.4+rng()*0.2),CH*(0.4+rng()*0.2));const sz=Math.min(CW,CH)*(0.09+rng()*0.06);
    s.w=t==='airfoil'?sz*2.4:sz;s.h=t==='airfoil'?sz*0.55:sz;s.angle=t==='airfoil'?(rng()-0.5)*0.5:rng()*6.283;
    if(t==='gear'||t==='star')s.spin=(rng()<0.5?-1:1)*(0.08+rng()*0.15)*rate;shapes.push(s);barrierDirty=true;R.obstacle=s;}
  const now=performance.now();
  // Start each slot part way through its life, so the first fades come at
  // different times; the first actors start at full strength.
  for(let i=0;i<R.slots;i++){const A=saverSpawn(R,i,now);const age=A.fade+rng()*(A.life-2*A.fade)*0.7;A.birth=now-age*1000;R.actors.push(A);emitters.push(A.e);}
  R.scene0=R.scene;saverRun=R;
  R.label=opts.labels===false||typeof opts.label!=='function'?null:opts.label;R.plateT=0;
  let last=now;(function tick(t){if(saverRun!==R)return;R.raf=requestAnimationFrame(tick);const dt=Math.min((t-last)/1000,0.1);last=t;R.hueShift+=dt*rate*0.3;
    if(R.label&&t-R.plateT>=1000){R.plateT=t;saverPlate(R);}
    const cw=CW,ch=CH;
    for(let j=R.actors.length-1;j>=0;j--){const A=R.actors[j],e=A.e,age=(t-A.birth)/1000;
      if(age>=A.life){R.actors.splice(j,1);const ix=emitters.indexOf(e);if(ix>=0)emitters.splice(ix,1);continue;}
      if(!A.next&&age>=A.life-A.fade){A.next=true;const N=saverSpawn(R,A.slot,t);R.actors.push(N);emitters.push(N.e);}
      const s=x=>x<=0?0:x>=1?1:x*x*(3-2*x),f=s(age/A.fade)*s((A.life-age)/A.fade),tt=age*A.w;
      e.angle=A.ba+A.wob*Math.sin(tt+A.ph)+0.4*A.wob*Math.sin(tt*2.3+A.ph*1.7);
      e.x=(A.bx+A.pd*Math.sin(tt*0.7+A.ph*2.1))*cw;e.y=(A.by+A.pd*Math.cos(tt*0.6+A.ph))*ch;
      e.mult=R.k*f*(0.85+0.15*Math.sin(tt*0.8+A.ph*0.5));
      const c=saverHsl(A.hue+R.hueShift,A.sat,A.lit),g=f*(e.type==='vortex'?0.45:0.9);e.dyeR=c[0]*g;e.dyeG=c[1]*g;e.dyeB=c[2]*g;}
  })(now);
  return R;}
// The label plate (opts.label) names the scene and gives the equations that
// step() solves: momentum and incompressibility, then the projection (the
// pressure Poisson solve by SIM.jacobiIters Jacobi sweeps and the gradient
// subtraction). The saver sets SIM.viscosity to SAVER_NU, so step() runs the
// viscous stage. The params give nu, dt, the Jacobi sweeps and the jet and stirrer
// count. The lines give the scene, the obstacle and the grid. The TeX and the
// rules match the equations panel (equations.js). The director calls it every 1 s.
// The plate code extract: shaders/jacobi.frag.glsl main(), laid out to read
// (the shader file is minified onto one line). Keep the two in step.
const SAVER_CODE={lang:'GLSL',name:'jacobi.frag · one pressure sweep',text:`// p_new = (p_L + p_R + p_D + p_U - div u) / 4
void main() {
  vec2 uv = vUV;
  vec2 dx = vec2(uInvRes.x, 0), dy = vec2(0, uInvRes.y);
  float p = sP(uv - dx) + sP(uv + dx)
          + sP(uv - dy) + sP(uv + dy);
  float div = texture(uDivergence, uv).x;
  fragColor = vec4((p - div) * .25, 0, 0, 0);
}`};
const SAVER_SCENE_TEXT={crossfire:'jets from the four edges aim at the centre',carousel:'jets on a ring push round it',wake:'a jet from the left edge flows past an obstacle',fountain:'jets rise and fall from the top and bottom edges'};
function saverPlate(R){if(!R.label)return;let jets=0,vort=0;for(const A of R.actors){if(A.e.type==='vortex')vort++;else jets++;}
  const ob=R.obstacle,nu=SIM.viscosity;
  // Parameters: TeX symbol, short name, live value. The classes are FL_RULES
  // in equations.js (u and w m1, p m2, nu m3, rho m5, f m6). The dye fills
  // the whole canvas, so the plate has no anchor and no leader line.
  const params=[{sym:'\\nu',name:'viscosity',value:nu>1e-4?nu.toFixed(3):'0, Re → ∞',cls:'m3'},
    {sym:'\\Delta t',name:'time step',value:(deltaTime*1000).toFixed(1)+' ms'},
    {sym:'p',name:'pressure solve',value:SIM.jacobiIters+' Jacobi sweeps',cls:'m2'},
    {sym:'f',name:'forcing',value:jets+' jet'+(jets===1?'':'s')+(vort?' · '+vort+' stirrer'+(vort===1?'':'s'):''),cls:'m6'}];
  const lines=['Scene '+R.scene+': '+SAVER_SCENE_TEXT[R.scene]+(ob?', obstacle '+ob.type+(ob.spin?' (spins)':''):'')+'.',
    'Grid '+simW+' × '+simH+'. Dye is advected semi-Lagrangian.'];
  try{R.label({title:'Stable fluids · '+R.scene,sub:'2D incompressible Navier–Stokes (Stam 1999)',params,lines,
    tex:[String.raw`\frac{\partial\vec{u}}{\partial t}+(\vec{u}\cdot\nabla)\vec{u}=-\frac{1}{\rho}\nabla p+\nu\nabla^2\vec{u}+\vec{f}`,String.raw`\nabla\cdot\vec{u}=0`,
      String.raw`\nabla^2 p=\frac{\rho}{\Delta t}\nabla\cdot\vec{w}`,String.raw`\vec{u}=\vec{w}-\frac{\Delta t}{\rho}\nabla p`],
    rules:[['u','m1'],['w','m1'],['p','m2'],['\\nu','m3'],['\\rho','m5'],['f','m6']],code:SAVER_CODE,
    eq:['∂u/∂t + (u·∇)u = −∇p/ρ + ν∇²u + f','∇·u = 0','∇²p = (ρ/Δt) ∇·w','u = w − (Δt/ρ) ∇p']});}catch(e){}}
window.snSaver={async enter(opts){
  await new Promise(r=>setTimeout(r,150));  // let the boot randomScene() run first
  const st=document.createElement('style');st.id='saver-style';st.textContent='html.saver #panel,html.saver #mob-btn,html.saver #quick-bar,html.saver #eq-panel,html.saver #status-bar,html.saver .topbar,html.saver #display-canvas{display:none!important}html.saver body::before,html.saver body::after{display:none}html.saver #canvas-wrap{position:fixed;inset:0;z-index:1}html.saver,html.saver body{cursor:none}';
  document.head.appendChild(st);document.documentElement.classList.add('saver');
  resize();pointers.clear();splats=[];toggleAutoSplash(false);SIM.showVectors=false;SIM.drawMode=SIM.eraseMode=false;SIM.playing=true;SIM.gravity=false;SIM.viscosity=SAVER_NU;SIM.curl=0;SIM.dyeFade=0.997;SIM.bloom=0.25;setCmap(3);
  const R=saverStart(opts);window.__saverScene=R.scene+'/'+R.slots;
  const until=performance.now()+2400;(function pw(){if(performance.now()<until){for(let i=0;i<3;i++){step();frame++;}requestAnimationFrame(pw);}})();
  return{canvas,warmupMs:2500};},
  exit(){if(saverRun){cancelAnimationFrame(saverRun.raf);saverRun=null;}
    const st=document.getElementById('saver-style');if(st)st.remove();document.documentElement.classList.remove('saver');
    SIM.viscosity=0;SIM.bloom=0.4;SIM.curl=+document.getElementById('sl-curl').value;SIM.dyeFade=+document.getElementById('sl-fade').value;resize();clearAll();randomScene();}};
})();
