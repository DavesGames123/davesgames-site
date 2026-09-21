// ============================================================================
//  MOLECULAR BOND  ·  WebGPU LCAO molecular-orbital simulator
// ----------------------------------------------------------------------------
//  Atoms are placed in 3D; the code samples the LCAO wavefunction ψ = Σ phase·φ
//  as a point cloud, colours each point on the GPU, and draws it as a billboard.
//  A CPU physics model gives each atom pair a bonding/antibonding energy and
//  force, which drive an optional 3D "release" dynamics and the 2D bond overlay.
//
//  DATA + RENDER PIPELINE
//  ----------------------
//      atoms AD[] ─┬─ sampleMO()  CPU rejection-samples |ψ|² → positions buffer
//                  │                                          (pB, GPU storage)
//                  ├─ writeAtomBuf() → atom buffer aB
//                  ▼
//      compute pass  cs()  reads pB + aB → writes colour buffer cB
//                  ▼
//      render pass   vs/fs  draw(6, count) billboards pB coloured by cB → <canvas #c>
//                  ▼
//      drawOverlay() 2D canvas #ov: bond lines, distances, atom labels
//
//  FRAME LOOP  (function frame)
//      if releasing: stepDyn() integrates nuclei, periodically re-sample
//      if dirty:     rebuild()  re-sample the cloud
//      if colorDirty: runCompute()  recolour ; then renderFrame() + drawOverlay()
//
//  SECTION MAP  (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      elements ............. "ELEMENTS"          Slater Z_eff table + swatches
//      matrix math .......... "const M4"          perspective / lookAt
//      orbitals ............. "const ORBS"        orbital type table (n, degree)
//      physics .............. "PHYSICS"           overlap, H2+ energy, Morse pair
//      sampling ............. "SAMPLING"          rejection sampler for |ψ|²
//      state ................ "STATE"             AD atoms, ST sim settings
//      camera ............... "class OrbitCam"    orbit camera
//      overlay .............. "OVERLAY"           2D bond/label canvas
//      shaders .............. "WGSL"              loaded render/compute source
//      gpu init ............. "initGPU"           device, buffers, pipelines
//      main ................. "MAIN"              rebuild/compute/render + UI
//      dynamics ............. "stepDyn"           nuclear force integration
//      presets .............. "PRESETS"           named molecule setups
//      frame loop ........... "function frame"    per-frame dispatch
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
// Fetch both WGSL programs before any GPU setup, so init stays synchronous.
const SH = await loadShaders(import.meta.url, [
  'shaders/render.wgsl',
  'shaders/compute.wgsl',
]);
if(window!==window.top)document.body.classList.add('in-frame');

/* ═══ ELEMENTS — Slater effective nuclear charges ═══ */
// Elements H..Ne. z is the Slater effective nuclear charge that compresses the
// hydrogen-like orbitals; c is the display colour used for labels and swatches.
const EL=[
  {s:'H', name:'Hydrogen', z:1.00, c:'#e0e0e0'},
  {s:'He',name:'Helium',   z:1.69, c:'#a8d8ff'},
  {s:'Li',name:'Lithium',  z:1.28, c:'#cc80ff'},
  {s:'Be',name:'Beryllium',z:1.91, c:'#c2ff00'},
  {s:'B', name:'Boron',    z:2.42, c:'#ffb5b5'},
  {s:'C', name:'Carbon',   z:3.14, c:'#808080'},
  {s:'N', name:'Nitrogen', z:3.83, c:'#3050f8'},
  {s:'O', name:'Oxygen',   z:4.45, c:'#ff2010'},
  {s:'F', name:'Fluorine', z:5.13, c:'#90e050'},
  {s:'Ne',name:'Neon',     z:5.76, c:'#b3e3f5'},
];
// Build the element picker buttons, one per entry in EL, colour-coded per element.
(function(){var g=document.getElementById('elem-grid');
  EL.forEach(function(e,i){var b=document.createElement('button');b.className='elem-btn'+(i===0?' active':'');b.dataset.el=i;b.textContent=e.s;b.style.borderBottomColor=e.c;b.style.borderBottomWidth='2px';g.appendChild(b)})})();

// Minimal column-major 4x4 matrix helpers: a perspective projection and a
// lookAt view matrix, written directly into a caller-provided Float32Array.
const M4={
  perspective(o,f,a,n,fa){o.fill(0);var t=1/Math.tan(f*.5),nf=1/(n-fa);o[0]=t/a;o[5]=t;o[10]=fa*nf;o[11]=-1;o[14]=n*fa*nf},
  lookAt(o,e,c,u){var fx=c[0]-e[0],fy=c[1]-e[1],fz=c[2]-e[2],fl=Math.hypot(fx,fy,fz);fx/=fl;fy/=fl;fz/=fl;var sx=fy*u[2]-fz*u[1],sy=fz*u[0]-fx*u[2],sz=fx*u[1]-fy*u[0],sl=Math.hypot(sx,sy,sz);sx/=sl;sy/=sl;sz/=sl;var ux=sy*fz-sz*fy,uy=sz*fx-sx*fz,uz=sx*fy-sy*fx;o[0]=sx;o[1]=ux;o[2]=-fx;o[3]=0;o[4]=sy;o[5]=uy;o[6]=-fy;o[7]=0;o[8]=sz;o[9]=uz;o[10]=-fz;o[11]=0;o[12]=-(sx*e[0]+sy*e[1]+sz*e[2]);o[13]=-(ux*e[0]+uy*e[1]+uz*e[2]);o[14]=fx*e[0]+fy*e[1]+fz*e[2];o[15]=1}};
// Orbital table indexed by ot: name, principal quantum number n (sets orbital
// size and sampling range), and dg, an empirical draw-density weight.
const ORBS=[{id:0,name:'1s',n:1,dg:4},{id:1,name:'2s',n:2,dg:6},{id:2,name:'2pσ',n:2,dg:5},{id:3,name:'2pπ',n:2,dg:5},{id:4,name:'3s',n:3,dg:8},{id:5,name:'3pσ',n:3,dg:7},{id:6,name:'3pπ',n:3,dg:7},{id:7,name:'3dσ',n:3,dg:8},{id:8,name:'3dπ',n:3,dg:8},{id:9,name:'3dδ',n:3,dg:9}];

/* ═══ PHYSICS ═══ */
// Overlap integral S(R) between two 1s orbitals at separation R (atomic units).
function overlapS(R){return Math.exp(-R)*(1+R+R*R/3)}
/* eB1s: exact H₂⁺ MO energy. s=+1 bonding (E_+), s=-1 antibonding (E_-).
   E_± = -½ + 1/R + (J ± K)/(1 ± S)   [algebraically unified via the s factor below] */
function eB1s(R,s){if(s===undefined)s=1;if(R<.15)return 100;
  var S=overlapS(R),J=-(1/R)*(1-(1+R)*Math.exp(-2*R)),K=-(1+R)*Math.exp(-R);
  return(-.5+1/R+J+s*(-.5*S+S/R+K))/(1+s*S)}
/* ePair: pair interaction energy.
   - H-H 1s gets the exact H₂⁺ formula (bonding or antibonding by phase product).
   - Everything else uses a Morse potential calibrated to give pedagogically
     reasonable equilibria. The pure-LCAO heuristic gave net repulsion for any
     non-hydrogen pair because (Z_A·Z_B−1)/R always dominates the Z²/n²-scaled
     attractive part at typical bond distances (the H₂⁺ formula is barely bound
     at the corresponding Rs ~ R·Z/n).
   - Phase product < 0 (antibonding) is mapped to a purely repulsive exponential
     so the simulation correctly shows atoms separating. */
function ePair(R,oA,oB,zA,zB,pp){
  if(R<.2)R=.2; if(pp===undefined)pp=1;
  var nA=ORBS[oA].n,nB=ORBS[oB].n;
  if(oA===0&&oB===0&&zA<1.05&&zB<1.05){return eB1s(R,pp>=0?1:-1)}
  var zAvg=(zA+zB)/2,nE=Math.max(nA,nB);
  /* Morse parameters (empirical, tuned for visible bond formation on Release 3D) */
  var Re=0.9+0.85*(nA+nB)/Math.sqrt(zAvg);
  var De=0.11*Math.pow(zAvg,1.2)/Math.pow(nE,0.4);
  var a=1.0;
  if(pp<0){return De*Math.exp(-a*(R-Re))}
  var t=Math.exp(-a*(R-Re));
  return De*(t-1)*(t-1)-De}
// Force between a pair: the negative numerical derivative of ePair over R.
function pairForce(R,oA,oB,zA,zB,pp){return-(ePair(R+.005,oA,oB,zA,zB,pp)-ePair(R-.005,oA,oB,zA,zB,pp))/.01}
// Hydrogen-like atomic orbital amplitude at (x,y,z) for orbital type id, at
// Z=1. The switch holds the analytic radial/angular forms for 1s..3dδ; this is
// the CPU twin of eo() in compute.wgsl, kept identical so sampling and colour agree.
function evalAtom(x,y,z,id){var r=Math.hypot(x,y,z);if(r<.001)return 0;switch(id){
  case 0:return .5642*Math.exp(-r);case 1:return .09973*(2-r)*Math.exp(-r*.5);
  case 2:return .09973*x*Math.exp(-r*.5);case 3:return .09973*y*Math.exp(-r*.5);
  case 4:return .004022*(27-18*r+2*r*r)*Math.exp(-r/3);case 5:return .01478*x*(4-2*r/3)*Math.exp(-r/3);
  case 6:return .01478*y*(4-2*r/3)*Math.exp(-r/3);case 7:return .002842*(2*x*x-y*y-z*z)*Math.exp(-r/3);
  case 8:return .009847*x*y*Math.exp(-r/3);case 9:return .009847*y*z*Math.exp(-r/3)}return 0}
// Same orbital scaled by effective charge Z: contract space by Z and renormalize.
function evalAtomZ(x,y,z,id,Z){return Math.pow(Z,1.5)*evalAtom(x*Z,y*Z,z*Z,id)}

/* ═══ SAMPLING ═══ */
// SCALE maps atomic units to world units; MAX_ATOMS/MAX_P bound the buffers.
var SCALE=.8,MAX_ATOMS=16,MAX_P=500000;
// Rejection-sample the molecular orbital into a point cloud. Candidate points
// are drawn near a random atom, then kept with probability proportional to
// |ψ|²/(mean atomic density), so the cloud traces the true bonding shape. The
// first nA points are the nuclei (w=6). Returns positions (xyzw) and the count.
function sampleMO(AD,count){
  var nA=AD.length,nMax=1,zMax=1;
  for(var i=0;i<nA;i++){nMax=Math.max(nMax,ORBS[AD[i].ot].n);zMax=Math.max(zMax,EL[AD[i].el].z)}
  var sc=SCALE/nMax,total=count+nA,pos=new Float32Array(total*4);
  for(var a=0;a<nA;a++){var k=a*4;pos[k]=AD[a].x*sc;pos[k+1]=AD[a].y*sc;pos[k+2]=AD[a].z*sc;pos[k+3]=6}
  // Attempt budget scales with orbital size (larger n needs more tries).
  var filled=nA,att=0,mx=count*(nMax>=3?80:40);
  while(filled<total&&att<mx){att++;
    // Pick a random atom and draw a radius from a gamma-like distribution.
    var ai=Math.floor(Math.random()*nA),A=AD[ai],nR=ORBS[A.ot].n,Z=EL[A.el].z;
    var r=-(Math.log(Math.random()+1e-30)+Math.log(Math.random()+1e-30)+Math.log(Math.random()+1e-30))*nR*.5/Z;
    // Random direction on the sphere gives the candidate position.
    if(r<.01)continue;var ct=1-2*Math.random(),st=Math.sqrt(Math.max(0,1-ct*ct)),ph=Math.random()*6.283185;
    var x=A.x+r*st*Math.cos(ph),y=A.y+r*ct,z=A.z+r*st*Math.sin(ph),psi=0,sI=0;
    // Sum every atom's phased contribution to get ψ and the atomic density sI.
    for(var j=0;j<nA;j++){var Zj=EL[AD[j].el].z;var phi=evalAtomZ(x-AD[j].x,y-AD[j].y,z-AD[j].z,AD[j].ot,Zj);psi+=AD[j].ph*phi;sI+=phi*phi}
    var dP=sI/nA;if(dP<1e-30)continue;
    // Accept with probability |ψ|² over the proposal density; store scaled to world.
    if(Math.random()<psi*psi/(4*dP)){var k=filled*4;pos[k]=x*sc;pos[k+1]=y*sc;pos[k+2]=z*sc;pos[k+3]=1;filled++}}
  return{positions:pos,count:filled}}

/* ═══ STATE ═══ */
// Lower the default particle budget on mobile hardware.
var isMob=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)||innerWidth<768;
// Make an atom record: position, orbital type ot, phase ph, element el, velocity.
function mkA(x,y,z,el){return{x:x||0,y:y||0,z:z||0,ot:0,ph:1,el:el||0,vx:0,vy:0,vz:0}}
// AD is the atom list; selIdx the edited atom; layoutMode grid or line.
var AD=[mkA(-1.75),mkA(1.75)],selIdx=0,layoutMode='grid';
// ST holds all live simulation settings and the dirty flags that gate rebuilds.
var ST={colorMode:0,N:isMob?20000:80000,psize:.06,gain:4,spread:3.5,releasing:false,dirty:true,colorDirty:false,liveCount:0};
// Reposition atoms on a grid or a line, spaced by ST.spread, and reset velocity.
function relayout(){var n=AD.length;
  if(layoutMode==='grid'){var d=[n,1,1];if(n>2)d=[2,2,1];if(n>4)d=[2,2,2];if(n>8)d=[3,2,2];if(n>12)d=[3,3,2];
    var idx=0;for(var iz=0;iz<d[2]&&idx<n;iz++)for(var iy=0;iy<d[1]&&idx<n;iy++)for(var ix=0;ix<d[0]&&idx<n;ix++){
      AD[idx].x=(ix-(d[0]-1)/2)*ST.spread;AD[idx].y=(iy-(d[1]-1)/2)*ST.spread;AD[idx].z=(iz-(d[2]-1)/2)*ST.spread;AD[idx].vx=AD[idx].vy=AD[idx].vz=0;idx++}}
  else{var w=(n-1)*ST.spread;for(var i=0;i<n;i++){AD[i].x=-w/2+i*ST.spread;AD[i].y=0;AD[i].z=0;AD[i].vx=AD[i].vy=AD[i].vz=0}}
  if(selIdx>=n)selIdx=n-1}
// Largest principal quantum number in play; drives the world scale factor.
function getNMax(){var m=1;for(var i=0;i<AD.length;i++)m=Math.max(m,ORBS[AD[i].ot].n);return m}

/* ═══ CAMERA ═══ */
// Orbit camera: pointer drag spins theta/phi, wheel changes radius. update()
// rebuilds the view and projection matrices from those spherical coordinates.
class OrbitCam{constructor(c){this.theta=.3;this.phi=.5;this.radius=16;this.target=[0,0,0];this.view=new Float32Array(16);this.proj=new Float32Array(16);
  var dr=false,lx,ly,s=this;
  c.addEventListener('pointerdown',function(e){dr=true;lx=e.clientX;ly=e.clientY;c.setPointerCapture(e.pointerId)});
  c.addEventListener('pointermove',function(e){if(!dr)return;s.phi-=(e.clientX-lx)*.005;s.theta=Math.max(-1.5,Math.min(1.5,s.theta+(e.clientY-ly)*.005));lx=e.clientX;ly=e.clientY});
  c.addEventListener('pointerup',function(){dr=false});
  c.addEventListener('wheel',function(e){s.radius=Math.max(2,Math.min(120,s.radius+e.deltaY*.03));e.preventDefault()},{passive:false})}
  update(a){var ct=Math.cos(this.theta),st=Math.sin(this.theta),cp=Math.cos(this.phi),sp=Math.sin(this.phi);
    var e=[this.target[0]+this.radius*ct*sp,this.target[1]+this.radius*st,this.target[2]+this.radius*ct*cp];
    M4.lookAt(this.view,e,this.target,[0,1,0]);M4.perspective(this.proj,Math.PI/3,a,.1,500)}}

/* ═══ OVERLAY ═══ */
// The 2D overlay canvas draws bond lines and labels on top of the GPU render.
var cam,ov=document.getElementById('ov'),octx=ov.getContext('2d');
// Project a world point through the camera view+proj to screen pixels, or null
// when it is behind the camera. Used to place bond lines and atom labels.
function proj3D(wx,wy,wz){var V=cam.view,P=cam.proj;
  var vx=V[0]*wx+V[4]*wy+V[8]*wz+V[12],vy=V[1]*wx+V[5]*wy+V[9]*wz+V[13],vz=V[2]*wx+V[6]*wy+V[10]*wz+V[14],vw=V[3]*wx+V[7]*wy+V[11]*wz+V[15];
  var cx=P[0]*vx+P[4]*vy+P[8]*vz+P[12]*vw,cy=P[1]*vx+P[5]*vy+P[9]*vz+P[13]*vw,cw=P[3]*vx+P[7]*vy+P[11]*vz+P[15]*vw;
  if(cw<.001)return null;return{x:(cx/cw*.5+.5)*innerWidth,y:(1-(cy/cw*.5+.5))*innerHeight}}
// Redraw the overlay: a colour-coded line for every atom pair (cyan attractive,
// red repulsive, thickness by force magnitude), the selected pair's distance,
// then each atom's element symbol and orbital name.
function drawOverlay(){ov.width=innerWidth;ov.height=innerHeight;octx.clearRect(0,0,ov.width,ov.height);
  var sc=SCALE/getNMax(),nA=AD.length;
  // Bond lines: one per pair, coloured and weighted by the pair force.
  for(var i=0;i<nA;i++)for(var j=i+1;j<nA;j++){
    var pi=proj3D(AD[i].x*sc,AD[i].y*sc,AD[i].z*sc),pj=proj3D(AD[j].x*sc,AD[j].y*sc,AD[j].z*sc);
    if(!pi||!pj)continue;var r=Math.hypot(AD[j].x-AD[i].x,AD[j].y-AD[i].y,AD[j].z-AD[i].z);
    var F=pairForce(r,AD[i].ot,AD[j].ot,EL[AD[i].el].z,EL[AD[j].el].z,AD[i].ph*AD[j].ph),t=Math.min(1,Math.sqrt(Math.abs(F))*1.4);
    var sel=i===selIdx||j===selIdx;
    octx.strokeStyle=F<0?'rgba(92,216,232,'+(t*(sel?.78:.3))+')':'rgba(232,116,102,'+(t*(sel?.78:.3))+')';
    octx.lineWidth=Math.max(1,t*(sel?4.5:2.2));octx.beginPath();octx.moveTo(pi.x,pi.y);octx.lineTo(pj.x,pj.y);octx.stroke();
    if(sel&&t>.04){var mx=(pi.x+pj.x)/2,my=(pi.y+pj.y)/2;
      octx.font='bold 12px "JetBrains Mono"';octx.fillStyle=F<0?'rgba(92,216,232,0.78)':'rgba(232,116,102,0.78)';
      octx.textAlign='left';octx.fillText(r.toFixed(2)+' a₀',mx+7,my-6)}}
  // Atom labels: element symbol above, orbital name below each projected nucleus.
  octx.textAlign='center';
  for(var i=0;i<nA;i++){var p=proj3D(AD[i].x*sc,AD[i].y*sc,AD[i].z*sc);if(!p)continue;
    var isSel=i===selIdx,E=EL[AD[i].el];
    octx.font=(isSel?'bold ':'')+' 15px "JetBrains Mono"';octx.fillStyle=isSel?'rgba(255,200,50,0.95)':E.c;
    octx.fillText(E.s,p.x,p.y-16);
    octx.font='12px "JetBrains Mono"';octx.fillStyle='rgba(200,210,230,0.42)';
    octx.fillText(ORBS[AD[i].ot].name,p.x,p.y+24)}}

/* ═══ WGSL (unchanged) ═══ */
var RENDER_WGSL=SH['shaders/render.wgsl'];

var COMPUTE_WGSL=SH['shaders/compute.wgsl'];

/* ═══ GPU INIT ═══ */
// Show a fatal GPU message in the on-page error banner.
function showErr(m){var e=document.getElementById('gpu-err');e.textContent='GPU: '+m;e.style.display='block'}
// Report any WGSL compile errors for module m (labelled l) and return success.
async function checkShader(d,m,l){var i=await m.getCompilationInfo();for(var msg of i.messages)if(msg.type==='error'){showErr('['+l+'] '+msg.message+' ('+msg.lineNum+':'+msg.linePos+')');return false}return true}
// Bring up WebGPU: adapter, device, canvas context, all storage/uniform buffers,
// the depth texture, both shader modules and pipelines, and the bind groups.
// Returns a bundle of handles, or null on any failure (with a message shown).
async function initGPU(){
  if(!navigator.gpu){document.getElementById('no-webgpu').style.display='flex';return null}
  var a=await navigator.gpu.requestAdapter();if(!a){document.getElementById('no-webgpu').style.display='flex';return null}
  var dv=await a.requestDevice();dv.lost.then(function(i){showErr('Lost: '+i.message)});
  // The tab shell removes this iframe on a page swap. Release the device so
  // the renderer does not run out of GPU memory during heavy swapping.
  window.addEventListener('pagehide',function(){try{dv.destroy();}catch(e){}});
  var cv=document.getElementById('c'),cx=cv.getContext('webgpu');if(!cx){showErr('No ctx');return null}
  var fm=navigator.gpu.getPreferredCanvasFormat(),dp=Math.min(devicePixelRatio,2);
  cv.width=innerWidth*dp;cv.height=innerHeight*dp;cx.configure({device:dv,format:fm,alphaMode:'premultiplied'});
  // Buffers: pB positions, cB colours (both MAX_P vec4f), rU/cU uniforms, aB
  // atom data, and dT a depth texture. All sized for the worst-case counts.
  var pB=dv.createBuffer({size:MAX_P*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  var cB=dv.createBuffer({size:MAX_P*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  var rU=dv.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  var cU=dv.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  var aB=dv.createBuffer({size:MAX_ATOMS*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  var dT=dv.createTexture({size:[cv.width,cv.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  // Compile both WGSL modules and stop if either reports an error.
  var rM=dv.createShaderModule({code:RENDER_WGSL}),cM=dv.createShaderModule({code:COMPUTE_WGSL});
  if(!await checkShader(dv,rM,'render')||!await checkShader(dv,cM,'compute'))return null;
  // Bind group layouts: render reads uniforms + positions + colours; compute
  // reads uniforms + positions + atoms and writes colours.
  var rL=dv.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
  var cL=dv.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}]});
  // Build the render pipeline inside an error scope: additive blend, depth test
  // on but no depth write (translucent sprites), and surface any validation error.
  dv.pushErrorScope('validation');
  var rP=dv.createRenderPipeline({layout:dv.createPipelineLayout({bindGroupLayouts:[rL]}),vertex:{module:rM,entryPoint:'vs',buffers:[]},fragment:{module:rM,entryPoint:'fs',targets:[{format:fm,blend:{color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
  var e1=await dv.popErrorScope();if(e1){showErr('Render: '+e1.message);return null}
  // Build the compute pipeline in its own error scope.
  dv.pushErrorScope('validation');
  var cP=dv.createComputePipeline({layout:dv.createPipelineLayout({bindGroupLayouts:[cL]}),compute:{module:cM,entryPoint:'cs'}});
  var e2=await dv.popErrorScope();if(e2){showErr('Compute: '+e2.message);return null}
  // Bind the buffers to each pipeline once; only their contents change per frame.
  var rG=dv.createBindGroup({layout:rL,entries:[{binding:0,resource:{buffer:rU}},{binding:1,resource:{buffer:pB}},{binding:2,resource:{buffer:cB}}]});
  var cG=dv.createBindGroup({layout:cL,entries:[{binding:0,resource:{buffer:cU}},{binding:1,resource:{buffer:pB}},{binding:2,resource:{buffer:cB}},{binding:3,resource:{buffer:aB}}]});
  // On resize, rescale the canvas and rebuild the depth texture to match.
  window.addEventListener('resize',function(){cv.width=innerWidth*dp;cv.height=innerHeight*dp;cx.configure({device:dv,format:fm,alphaMode:'premultiplied'});dT.destroy();dT=dv.createTexture({size:[cv.width,cv.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT})});
  // dt is a getter so callers always read the current (possibly resized) texture.
  return{dv:dv,cx:cx,cv:cv,pB:pB,cB:cB,rU:rU,cU:cU,aB:aB,rP:rP,cP:cP,rG:rG,cG:cG,dt:function(){return dT}}}

/* ═══ MAIN ═══ */
// Entry point: initialize the GPU, then define the per-frame work and wire up
// all the controls. Everything below closes over the GPU handle bundle G.
;(async function(){
var G=await initGPU();if(!G)return;
var dv=G.dv,cx=G.cx,cv=G.cv;cam=new OrbitCam(cv);var loadEl=document.getElementById('loading');
// Paint a range input's filled track via the --pct custom property.
function sg(el){el.style.setProperty('--pct',(el.value-el.min)/(el.max-el.min)*100+'%')}
document.querySelectorAll('input[type=range]').forEach(sg);
// Re-sample the point cloud and upload it. Guarded so only one runs at a time;
// deferred with a timeout so the loading indicator can paint first.
var rebuilding=false;
function rebuild(){if(rebuilding)return;ST.dirty=false;rebuilding=true;loadEl.classList.add('show');
  setTimeout(function(){var r=sampleMO(AD,ST.N);ST.liveCount=r.count;
    dv.queue.writeBuffer(G.pB,0,r.positions,0,r.count*4);ST.colorDirty=true;rebuilding=false;loadEl.classList.remove('show');updateDisplay()},5)}
// Pack the atom list into the GPU atom buffer: two vec4f per atom, matching the
// ad[] layout the compute shader reads (pos+phase, then orbital type + Z).
function writeAtomBuf(){var buf=new Float32Array(MAX_ATOMS*8);
  for(var i=0;i<AD.length;i++){var o=i*8;buf[o]=AD[i].x;buf[o+1]=AD[i].y;buf[o+2]=AD[i].z;buf[o+3]=AD[i].ph;
    buf[o+4]=AD[i].ot;buf[o+5]=EL[AD[i].el].z;buf[o+6]=0;buf[o+7]=0}
  dv.queue.writeBuffer(G.aB,0,buf)}
// Dispatch the colouring compute pass: refresh the atom buffer, write the
// compute uniforms, then run one thread per particle (256 per workgroup).
function runCompute(){if(ST.liveCount<3)return;writeAtomBuf();
  var sc=SCALE/getNMax(),b=new ArrayBuffer(32),f=new Float32Array(b),u=new Uint32Array(b);
  // Uniform layout mirrors the CU struct: gain, mode, atom count, 1/scale, count.
  f[0]=ST.gain;u[1]=ST.colorMode;u[2]=AD.length;f[3]=1/sc;u[4]=ST.liveCount;
  dv.queue.writeBuffer(G.cU,0,b);var enc=dv.createCommandEncoder(),pass=enc.beginComputePass();
  pass.setPipeline(G.cP);pass.setBindGroup(0,G.cG);pass.dispatchWorkgroups(Math.ceil(ST.liveCount/256));
  pass.end();dv.queue.submit([enc.finish()]);ST.colorDirty=false}
// Draw one frame: update the camera, write the render uniforms (view, proj,
// point size, count), then instance the billboard quad over every particle.
function renderFrame(){if(ST.liveCount<2)return;cam.update(cv.width/cv.height);
  var b=new ArrayBuffer(144),f=new Float32Array(b),u=new Uint32Array(b);
  f.set(cam.view,0);f.set(cam.proj,16);f[32]=ST.psize;u[33]=ST.liveCount;
  dv.queue.writeBuffer(G.rU,0,b);var enc=dv.createCommandEncoder();
  var pass=enc.beginRenderPass({colorAttachments:[{view:cx.getCurrentTexture().createView(),clearValue:{r:.035,g:.04,b:.06,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:G.dt().createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
  pass.setPipeline(G.rP);pass.setBindGroup(0,G.rG);pass.draw(6,ST.liveCount);pass.end();dv.queue.submit([enc.finish()])}
// Sum the pair energies over all atom pairs for the E_total readout.
function totalEnergy(){var E=0;for(var i=0;i<AD.length;i++)for(var j=i+1;j<AD.length;j++){var r=Math.hypot(AD[j].x-AD[i].x,AD[j].y-AD[i].y,AD[j].z-AD[i].z);if(r>.1)E+=ePair(r,AD[i].ot,AD[j].ot,EL[AD[i].el].z,EL[AD[j].el].z,AD[i].ph*AD[j].ph)}return E}
// Refresh the header/readout text (formula, energy, counts) and redraw overlay.
function updateDisplay(){var E=totalEnergy();
  var parts=AD.map(function(a){return EL[a.el].s});
  document.getElementById('ket-main').textContent=parts.join(' – ');
  document.getElementById('ket-sub').textContent=AD.length+'-atom LCAO Molecular Orbital';
  document.getElementById('h-e-val').textContent=E.toFixed(3);
  document.getElementById('e-live-top').textContent='E = '+E.toFixed(3)+' Ha';
  document.getElementById('bodyCount').textContent=AD.length;
  document.getElementById('partCount').textContent=ST.liveCount>=1000?(ST.liveCount/1000).toFixed(0)+'k':ST.liveCount;
  document.getElementById('p-info').textContent=ST.liveCount+' particles sampled';drawOverlay()}
// Sync the left panel widgets (element, orbital, phase, Z_eff) to the selected atom.
function updateLeftPanel(){var a=AD[selIdx];document.getElementById('sel-title').textContent='Atom '+(selIdx+1)+' · '+EL[a.el].s;
  document.querySelectorAll('#panel-a .p-orb').forEach(function(b){b.classList.toggle('active',+b.dataset.orb===a.ot)});
  document.querySelectorAll('.elem-btn').forEach(function(b){b.classList.toggle('active',+b.dataset.el===a.el)});
  document.getElementById('elem-z').innerHTML='Z<sub>eff</sub> = <span class="z-val">'+EL[a.el].z.toFixed(2)+'</span> <span class="nm">'+EL[a.el].name+'</span>';
  document.getElementById('tog-plus').className='p-tog'+(a.ph>0?' on':'');
  document.getElementById('tog-minus').className='p-tog'+(a.ph<0?' neg':'')}
// Rebuild the right-hand atom list; each row selects its atom when clicked.
function buildAtomList(){var el=document.getElementById('atom-list');el.innerHTML='';
  for(var i=0;i<AD.length;i++){(function(idx){
    var row=document.createElement('div');row.className='atom-row'+(idx===selIdx?' sel':'');
    var E=EL[AD[idx].el];
    row.innerHTML='<div class="atom-dot" style="background:'+E.c+';color:'+E.c+'"></div><span class="atom-name">Atom '+(idx+1)+'</span><span class="atom-el" style="color:'+E.c+'">'+E.s+'</span><span class="atom-orb">'+ORBS[AD[idx].ot].name+'</span><span class="atom-ph '+(AD[idx].ph>0?'pos':'neg')+'">'+(AD[idx].ph>0?'+':'−')+'</span>';
    row.addEventListener('click',function(){selIdx=idx;buildAtomList();updateLeftPanel();drawOverlay()});el.appendChild(row)})(i)}}
/* Auto-tune gain and camera from current atoms.
   Density at the bond region drops sharply with n (1/n^4 peak) and with Z (compact orbitals),
   so we boost gain by both. Camera radius zooms to actual orbital extent, not a hardcoded floor. */
function autoTune(updateSlider){
  var nMax=1, zSum=0, zMax=1;
  for(var i=0;i<AD.length;i++){
    var nR=ORBS[AD[i].ot].n, Z=EL[AD[i].el].z;
    if(nR>nMax)nMax=nR;
    if(Z>zMax)zMax=Z;
    zSum+=Z;
  }
  var zAvg=zSum/AD.length;
  // Gain: empirically calibrated so |ψ|² at the bond region maps to a useful color range
  var gain=Math.max(3.5,Math.min(28, 2.6*Math.pow(nMax,1.75)*Math.pow(Math.max(1,zAvg),0.55) ));
  ST.gain=gain;
  if(updateSlider){
    var sl=document.getElementById('sl-gain');
    sl.value=gain.toFixed(1);
    document.getElementById('vl-gain').textContent=gain.toFixed(1);
    sl.style.setProperty('--pct',(gain-sl.min)/(sl.max-sl.min)*100+'%');
  }
  ST.colorDirty=true;

  // Camera radius: hug actual world extent so heavy atoms appear at consistent visual size
  var sc=SCALE/nMax;
  var halfSpan=0;
  for(var i=0;i<AD.length;i++){
    halfSpan=Math.max(halfSpan, Math.hypot(AD[i].x,AD[i].y,AD[i].z)*sc);
  }
  var orbExt=0;
  for(var i=0;i<AD.length;i++){
    var nR=ORBS[AD[i].ot].n, Z=EL[AD[i].el].z;
    // ~3× mean radius for hydrogenic n,Z covers most of the visible density
    var aoExt=3*nR*nR/Z;
    orbExt=Math.max(orbExt, aoExt*sc);
  }
  cam.radius=Math.max(3.5, 1.55*(halfSpan+orbExt)+1.5);
}
// Re-tune gain and camera and push the gain slider (used after any atom edit).
function adjustCamera(){autoTune(true)}
/* 3D dynamics */
// Nuclear integrator constants: force-to-acceleration gain and per-frame damping.
var NUC_ACCEL=1800,NUC_DAMP=0.94;
// One velocity-Verlet-style step of the nuclei under pair forces, with damping
// and a centre-of-mass velocity subtraction so the whole system does not drift.
function stepDyn(dt){var nA=AD.length,fx=new Array(nA).fill(0),fy=new Array(nA).fill(0),fz=new Array(nA).fill(0);
  // Accumulate equal-and-opposite pair forces onto both atoms of every pair.
  for(var i=0;i<nA;i++)for(var j=i+1;j<nA;j++){var dx=AD[j].x-AD[i].x,dy=AD[j].y-AD[i].y,dz=AD[j].z-AD[i].z;
    var r=Math.sqrt(dx*dx+dy*dy+dz*dz);if(r<.3)r=.3;
    var F=pairForce(r,AD[i].ot,AD[j].ot,EL[AD[i].el].z,EL[AD[j].el].z,AD[i].ph*AD[j].ph);
    var fR=-F/r;
    fx[i]+=fR*dx;fy[i]+=fR*dy;fz[i]+=fR*dz;fx[j]-=fR*dx;fy[j]-=fR*dy;fz[j]-=fR*dz}
  // Frame-rate-independent damping factor.
  var damp=Math.pow(NUC_DAMP,dt*60);
  // Integrate velocity and position, applying damping.
  for(var i=0;i<nA;i++){AD[i].vx+=fx[i]*NUC_ACCEL*dt;AD[i].vy+=fy[i]*NUC_ACCEL*dt;AD[i].vz+=fz[i]*NUC_ACCEL*dt;
    AD[i].vx*=damp;AD[i].vy*=damp;AD[i].vz*=damp;AD[i].x+=AD[i].vx*dt;AD[i].y+=AD[i].vy*dt;AD[i].z+=AD[i].vz*dt}
  // Remove net momentum so the molecule stays centred in view.
  var cvx=0,cvy=0,cvz=0;for(var i=0;i<nA;i++){cvx+=AD[i].vx;cvy+=AD[i].vy;cvz+=AD[i].vz}
  cvx/=nA;cvy/=nA;cvz/=nA;for(var i=0;i<nA;i++){AD[i].vx-=cvx;AD[i].vy-=cvy;AD[i].vz-=cvz}ST.dirty=true}
/* PRESETS */
// Named molecule setups: atom list (element, orbital, phase), spacing, layout,
// starting gain, and a description shown in the info panel.
var PRESETS={
  h2:{atoms:[{el:0,ot:0,ph:1},{el:0,ot:0,ph:1}],spread:2.6,mode:'line',gain:4,desc:'H₂⁺. Exact one-electron σ(1s) bond between two hydrogen nuclei.'},
  hf:{atoms:[{el:0,ot:0,ph:1},{el:8,ot:2,ph:1}],spread:2.9,mode:'line',gain:14,desc:"H–F polar bond. Fluorine's Z_eff=5.13 pulls electron density strongly toward F."},
  n2:{atoms:[{el:6,ot:2,ph:1},{el:6,ot:2,ph:1}],spread:3.1,mode:'line',gain:17,desc:'N₂ σ bond. Two nitrogen 2pσ orbitals with Z_eff=3.83.'},
  co:{atoms:[{el:5,ot:2,ph:1},{el:7,ot:2,ph:1}],spread:3.0,mode:'line',gain:15,desc:'C–O bond. Asymmetric σ, electron density shifts toward oxygen.'},
  lih:{atoms:[{el:2,ot:1,ph:1},{el:0,ot:0,ph:1}],spread:3.8,mode:'line',gain:11,desc:'Li–H ionic-like bond. Lithium 2s + hydrogen 1s, large Z asymmetry.'},
  anti:{atoms:[{el:0,ot:0,ph:1},{el:0,ot:0,ph:-1}],spread:2.4,mode:'line',gain:5,desc:'Antibonding σ*(1s). Destructive interference, repulsive at all distances.'},
  chain:{atoms:[{el:5,ot:0,ph:1},{el:5,ot:0,ph:1},{el:5,ot:0,ph:1},{el:5,ot:0,ph:1}],spread:2.2,mode:'line',gain:13,desc:'Carbon chain. Four C(1s), delocalised bonding, precursor to band structure.'},
  cluster:{atoms:[{el:6,ot:0,ph:1},{el:6,ot:0,ph:1},{el:6,ot:0,ph:1},{el:6,ot:0,ph:1}],spread:2.1,mode:'grid',gain:17,desc:'Nitrogen cluster. Release in 3D to find equilibrium geometry.'}
};
// Load a preset by key: rebuild the atom list, apply spacing/layout/gain, sync
// the controls, recentre the camera, and re-sample. Exposed for the inline
// onclick handlers on the preset cards.
window.loadPresetUI=function(key,btn){
  document.querySelectorAll('.pcard').forEach(c=>c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  else{const c=document.querySelector('.pcard[data-pr="'+key+'"]');if(c)c.classList.add('active')}
  var P=PRESETS[key];if(!P)return;
  AD=P.atoms.map(function(a){var at=mkA(0,0,0,a.el);at.ot=a.ot;at.ph=a.ph;return at});
  ST.spread=P.spread;layoutMode=P.mode;
  document.getElementById('sl-d').value=ST.spread;sg(document.getElementById('sl-d'));document.getElementById('vl-d').textContent=ST.spread.toFixed(1);
  document.getElementById('btn-grid').classList.toggle('on',layoutMode==='grid');document.getElementById('btn-line').classList.toggle('on',layoutMode==='line');
  document.getElementById('p-info').textContent=P.desc;
  if(ST.releasing){ST.releasing=false;const rb=document.getElementById('btn-release');rb.classList.remove('on');rb.innerHTML='\u25b6 Release 3D'}
  selIdx=0;relayout();buildAtomList();updateLeftPanel();adjustCamera();ST.dirty=true;
  if(innerWidth<=980) closeDrawers();
};

/* UI */
// Control wiring. Each handler mutates the selected atom or ST, refreshes the
// affected panels, and sets a dirty flag so the frame loop re-samples or recolours.
// Orbital buttons: change the selected atom's orbital type.
document.querySelectorAll('#panel-a .p-orb').forEach(function(b){b.addEventListener('click',function(){AD[selIdx].ot=+b.dataset.orb;updateLeftPanel();buildAtomList();adjustCamera();ST.dirty=true})});
// Element buttons: change the selected atom's element.
document.querySelectorAll('.elem-btn').forEach(function(b){b.addEventListener('click',function(){AD[selIdx].el=+b.dataset.el;updateLeftPanel();buildAtomList();adjustCamera();ST.dirty=true})});
// Phase toggles: set the selected atom's wavefunction sign (bonding vs flipped).
document.getElementById('tog-plus').addEventListener('click',function(){AD[selIdx].ph=1;updateLeftPanel();buildAtomList();ST.dirty=true});
document.getElementById('tog-minus').addEventListener('click',function(){AD[selIdx].ph=-1;updateLeftPanel();buildAtomList();ST.dirty=true});
// Add / remove atoms, and grid / line layout toggles.
document.getElementById('btn-add').addEventListener('click',function(){if(AD.length>=MAX_ATOMS)return;AD.push(mkA());relayout();selIdx=AD.length-1;buildAtomList();updateLeftPanel();adjustCamera();ST.dirty=true});
document.getElementById('btn-sub').addEventListener('click',function(){if(AD.length<=1)return;AD.pop();if(selIdx>=AD.length)selIdx=AD.length-1;relayout();buildAtomList();updateLeftPanel();adjustCamera();ST.dirty=true});
document.getElementById('btn-grid').addEventListener('click',function(){layoutMode='grid';document.getElementById('btn-grid').classList.add('on');document.getElementById('btn-line').classList.remove('on');relayout();ST.dirty=true});
document.getElementById('btn-line').addEventListener('click',function(){layoutMode='line';document.getElementById('btn-line').classList.add('on');document.getElementById('btn-grid').classList.remove('on');relayout();ST.dirty=true});
// Sliders: R spacing (also cancels release), particle count, sprite size, gain.
document.getElementById('sl-d').addEventListener('input',function(){ST.spread=+this.value;document.getElementById('vl-d').textContent=ST.spread.toFixed(1);sg(this);relayout();ST.dirty=true;
  if(ST.releasing){ST.releasing=false;const rb=document.getElementById('btn-release');rb.classList.remove('on');rb.innerHTML='\u25b6 Release 3D'}});
document.getElementById('sl-N').addEventListener('input',function(){ST.N=+this.value;document.getElementById('vl-N').textContent=(ST.N>=1000?(ST.N/1000|0)+'k':ST.N);sg(this);ST.dirty=true});
document.getElementById('sl-sz').addEventListener('input',function(){ST.psize=+this.value;document.getElementById('vl-sz').textContent=ST.psize.toFixed(3);sg(this)});
document.getElementById('sl-gain').addEventListener('input',function(){ST.gain=+this.value;document.getElementById('vl-gain').textContent=ST.gain.toFixed(1);sg(this);ST.colorDirty=true});
// Visualization mode buttons: |ψ|², Δρ, or sign colouring.
document.querySelectorAll('.p-mode').forEach(function(b){b.addEventListener('click',function(){ST.colorMode=+b.dataset.mode;document.querySelectorAll('.p-mode').forEach(function(x){x.classList.remove('active')});b.classList.add('active');ST.colorDirty=true})});
// Release 3D: start/stop nuclear dynamics; kick atoms with small random velocities.
document.getElementById('btn-release').addEventListener('click',function(){ST.releasing=!ST.releasing;this.classList.toggle('on',ST.releasing);
  this.innerHTML=ST.releasing?'\u25a0 Freeze':'\u25b6 Release 3D';
  if(ST.releasing)for(var i=0;i<AD.length;i++){AD[i].vx=(Math.random()-.5)*.2;AD[i].vy=(Math.random()-.5)*.2;AD[i].vz=(Math.random()-.5)*.2}});
// Keyboard shortcuts: space release, +/- add/remove, arrows change selection.
document.addEventListener('keydown',function(e){if(e.target.tagName==='INPUT')return;
  if(e.key===' '){e.preventDefault();document.getElementById('btn-release').click()}
  if(e.key==='='||e.key==='+'){e.preventDefault();document.getElementById('btn-add').click()}
  if(e.key==='-'){e.preventDefault();document.getElementById('btn-sub').click()}
  if(e.key==='ArrowUp'&&selIdx>0){selIdx--;buildAtomList();updateLeftPanel();drawOverlay()}
  if(e.key==='ArrowDown'&&selIdx<AD.length-1){selIdx++;buildAtomList();updateLeftPanel();drawOverlay()}});
// Initial layout, panels, camera, and first cloud sample.
relayout();buildAtomList();updateLeftPanel();adjustCamera();rebuild();
// Per-frame loop. While releasing, integrate the nuclei and periodically
// re-sample (every ~0.08s) instead of every frame. Otherwise re-sample only
// when dirty. Recolour when colorDirty, then render and draw the overlay.
var lastT=0,rebT=0;
function frame(t){requestAnimationFrame(frame);var dt=Math.min((t-lastT)/1000,.05);lastT=t;
  if(ST.releasing){stepDyn(dt);rebT+=dt;if(rebT>.08){rebT=0;rebuild()}else{updateDisplay();ST.colorDirty=true}}
  if(ST.dirty&&!ST.releasing)rebuild();if(ST.colorDirty)runCompute();renderFrame();drawOverlay()}
requestAnimationFrame(frame)})()
