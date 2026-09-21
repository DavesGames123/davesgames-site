// ============================================================================
//  CUBE SDF + BRANCHED FLOW  ·  ray-marched solid crossed with flowing filaments
// ----------------------------------------------------------------------------
//  Two renderers share one scene. A ray-marched signed-distance surface (a
//  rounded cube with a torus carved through it) is the solid body; thousands of
//  thin filaments are traced on the CPU through a 3D "branched flow" vector
//  field, then drawn as instanced screen-space ribbons. The filaments reflect in
//  the metallic surface, and the surface occludes the filaments behind it, so
//  the two passes read as one object.
//
//  RENDER PIPELINE   (per frame)
//  ---------------------------------------------------------------------------
//      CPU (if filaments on):
//        genSeeds() ─▶ traceAll() integrate the flow field ─▶ buildBuf() ─▶ filBuf
//                                                             (instanced edges)
//      GPU passes:
//        1. filament ─▶ filFBO      no occlusion      = reflection source
//        2. sdf (u_mode=1) ─▶ distFBO   scene depth   t/500 packed in red
//        3. sdf (u_mode=0) ─▶ screen    metallic body, samples filFBO to reflect
//        4. filament ─▶ screen      occluded by distFBO depth (discard if behind)
//                              │
//                              ▼
//                           <canvas #gl>
//
//  FILAMENT TRACE   (CPU, traceAll)
//  ---------------------------------------------------------------------------
//      seed on torus rings ─▶ step along velocity v:
//        v += field3D(p)              branched-flow sinusoidal field
//        v -= (v·n) n                 project off the SDF gradient (hug surface)
//        v -= curve · dist · n        pull toward / push off the surface
//        v += curl(n, toCentre)       swirl term
//      positions become polyline nodes ─▶ edges ─▶ instanced ribbon quads
//
//  STATE
//  ---------------------------------------------------------------------------
//      P_   parameter defs (sliders + baked + shuffle-only + locked)
//      C_   checkbox defs (visibility + baked toggles)
//      cur  live numeric values (P_ -> cur); chk  live booleans (C_ -> chk)
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ---------------------------------------------------------------------------
//      shader load .......... "await fetch"        fetch .glsl before build
//      math ................. "MATH"               3x3 / 4x4, persp, lookAt
//      cpu sdf .............. "TORUS SDF ON CPU"    torus distance + gradient
//      parameters ........... "const P_"           tunables and their metadata
//      webgl setup .......... "WEBGL"              programs, uniforms, VAOs
//      fbo .................. "function mkFBO"      distance + reflection targets
//      flow field ........... "function field3D"    the branched-flow field
//      seeds + tracing ...... "function genSeeds"   seed and integrate filaments
//      buffer build ......... "function buildBuf"   filaments -> instanced edges
//      camera ............... "let resScale"        orbit state + resize
//      ui ................... "function buildUI"    sliders, toggles, shuffle
//      input ................ "canvas.onmousedown"  drag / wheel / touch
//      render ............... "function render"     the four-pass frame loop
// ============================================================================
(async () => {
// Shader source lives in real .glsl files. Fetch all four before building any
// program, so init runs in its original synchronous order.
const SDF_VS = await (await fetch(new URL('shaders/sdf.vert.glsl', document.baseURI))).text();
const SDF_FS = await (await fetch(new URL('shaders/sdf.frag.glsl', document.baseURI))).text();
const FIL_VS = await (await fetch(new URL('shaders/filament.vert.glsl', document.baseURI))).text();
const FIL_FS = await (await fetch(new URL('shaders/filament.frag.glsl', document.baseURI))).text();
// ═══════════════ SHADERS ═══════════════

// u_mode: 0=color output, 1=distance output (t/500 in red channel)



// ═══════════════ MATH ═══════════════
// Small linear-algebra kit used by the CPU trace and camera. rX3/rY3/rZ3 build
// 3x3 axis rotations; mM3/mV3 multiply; tM3 transposes; nrm normalizes; persp
// and lookAt build the 4x4 projection and view matrices; mM4 multiplies them.
const PI=Math.PI,TAU=PI*2;
function rX3(a){const c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,c,-s,0,s,c];}
function rY3(a){const c=Math.cos(a),s=Math.sin(a);return[c,0,-s,0,1,0,s,0,c];}
function rZ3(a){const c=Math.cos(a),s=Math.sin(a);return[c,-s,0,s,c,0,0,0,1];}
function mM3(a,b){const r=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++)
  r[i*3+j]=a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j];return r;}
function mV3(m,v){return[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],
  m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];}
function tM3(m){return[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];}
function nrm(v){const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1e-8;return[v[0]/l,v[1]/l,v[2]/l];}
function persp(f,a,n,r){const t=1/Math.tan(f/2),nf=1/(n-r);
  return new Float32Array([t/a,0,0,0,0,t,0,0,0,0,(r+n)*nf,-1,0,0,2*r*n*nf,0]);}
function lookAt(e,t,u){let zx=e[0]-t[0],zy=e[1]-t[1],zz=e[2]-t[2];
  let l=Math.sqrt(zx*zx+zy*zy+zz*zz)||1;const fz=[zx/l,zy/l,zz/l];
  let xx=u[1]*fz[2]-u[2]*fz[1],xy=u[2]*fz[0]-u[0]*fz[2],xz=u[0]*fz[1]-u[1]*fz[0];
  l=Math.sqrt(xx*xx+xy*xy+xz*xz)||1;const fx=[xx/l,xy/l,xz/l];
  const fy=[fz[1]*fx[2]-fz[2]*fx[1],fz[2]*fx[0]-fz[0]*fx[2],fz[0]*fx[1]-fz[1]*fx[0]];
  return new Float32Array([fx[0],fy[0],fz[0],0,fx[1],fy[1],fz[1],0,fx[2],fy[2],fz[2],0,
    -(fx[0]*e[0]+fx[1]*e[1]+fx[2]*e[2]),-(fy[0]*e[0]+fy[1]*e[1]+fy[2]*e[2]),
    -(fz[0]*e[0]+fz[1]*e[1]+fz[2]*e[2]),1]);}
function mM4(a,b){const r=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++)
  r[j*4+i]=a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];return r;}

// ═══════════════ TORUS SDF ON CPU ═══════════════
// A CPU copy of the torus distance field the shader carves with, so the trace
// can steer filaments along the same surface. pmF is a smooth-min, paF/pa3J are
// smooth-abs (rounded mirror folds). torDist returns signed distance to the
// carved torus; torGrad is its numeric gradient (surface normal direction).
function pmF(a,b,k){const h=Math.max(0,Math.min(1,.5+.5*(b-a)/k));return b+(a-b)*h-k*h*(1-h);}
function paF(a,k){return -pmF(a,-a,k);}
function pa3J(v,k){return[paF(v[0],k),paF(v[1],k),paF(v[2],k)];}
function torDist(wp,R,C,t){
  let p=mV3(R,wp);p=mV3(R,p);p=pa3J(p,C.pK);
  const off=pOff(C,t);
  p=[p[0]-off,p[1]-off,p[2]-off];p=mV3(R,p);
  const q=Math.sqrt(p[0]*p[0]+p[2]*p[2])-C.tM;
  return Math.sqrt(q*q+p[1]*p[1])-C.tm;}
function torGrad(wp,R,C,t){const e=.02,d0=torDist(wp,R,C,t);
  return nrm([torDist([wp[0]+e,wp[1],wp[2]],R,C,t)-d0,
    torDist([wp[0],wp[1]+e,wp[2]],R,C,t)-d0,torDist([wp[0],wp[1],wp[2]+e],R,C,t)-d0]);}

// ═══════════════ PARAMETERS ═══════════════
// Visible controls — everything else baked. Spin params shuffle-only (no sliders).
// Each entry: v default, mn/mx range, s step, l label, g group. A group of '_'
// and a label of '_' mean the value has no slider (baked or shuffle-only).
const P_={
// ── Playback ──
timeScale:{v:1,mn:0,mx:3,s:.05,l:'Time Scale',g:'_'},
// ── Color ──
cRH:{v:.65,mn:0,mx:1,s:.01,l:'Root Hue',g:'color'},
cTH:{v:.56,mn:0,mx:1,s:.01,l:'Tip Hue',g:'color'},
cSat:{v:1,mn:0,mx:1,s:.01,l:'Saturation',g:'color'},
cGrad:{v:.6,mn:0,mx:1,s:.05,l:'Gradient',g:'color'},
gH:{v:.675,mn:0,mx:1,s:.005,l:'Glow Hue',g:'color'},
gP:{v:2.1,mn:0,mx:4,s:.05,l:'Glow Power',g:'color'},
// ── Material ──
mBase:{v:.05,mn:0,mx:.5,s:.01,l:'Base',g:'mat'},
mMetal:{v:1.5,mn:0,mx:3,s:.05,l:'Metallic',g:'mat'},
mFres:{v:2.5,mn:.5,mx:6,s:.1,l:'Fresnel',g:'mat'},
// ── Structure ──
sN:{v:78,mn:4,mx:120,s:1,l:'Density',g:'struct'},
rCw:{v:10,mn:.5,mx:16,s:.5,l:'Width',g:'struct'},
// ── Shuffle-only (no UI, randomized by shuffle) ──
rS:{v:.5,mn:.1,mx:1.5,s:.05,l:'_',g:'_'},
moRA:{v:0,mn:0,mx:2,s:.01,l:'_',g:'_'},
moRB:{v:.5,mn:0,mx:2,s:.01,l:'_',g:'_'},
moRC:{v:.23,mn:0,mx:2,s:.01,l:'_',g:'_'},
// ── Locked (no UI, not shuffled) ──
sRings:{v:8,mn:1,mx:24,s:1,l:'_',g:'_'},
sR:{v:20,mn:5,mx:35,s:.5,l:'_',g:'_'},pK:{v:10,mn:.1,mx:20,s:.1,l:'_',g:'_'},
tO:{v:12,mn:0,mx:30,s:.5,l:'_',g:'_'},tM:{v:10,mn:.5,mx:20,s:.5,l:'_',g:'_'},
tm:{v:.125,mn:.01,mx:2,s:.01,l:'_',g:'_'},cD:{v:2,mn:0,mx:10,s:.1,l:'_',g:'_'},
pM:{v:5,mn:.1,mx:10,s:.1,l:'_',g:'_'},
moPulse:{v:0,mn:0,mx:5,s:.1,l:'_',g:'_'},moPulseR:{v:.5,mn:0,mx:3,s:.05,l:'_',g:'_'},
fFr:{v:.2,mn:.2,mx:8,s:.1,l:'_',g:'_'},fFrZ:{v:.2,mn:.2,mx:8,s:.1,l:'_',g:'_'},
fO2:{v:.2,mn:0,mx:2,s:.05,l:'_',g:'_'},fO3:{v:0,mn:0,mx:2,s:.05,l:'_',g:'_'},
fMo:{v:0,mn:0,mx:1,s:.01,l:'_',g:'_'},fCu:{v:.2,mn:0,mx:8,s:.1,l:'_',g:'_'},
fGa:{v:.48,mn:0,mx:1,s:.01,l:'_',g:'_'},
fWf:{v:0,mn:0,mx:8,s:.1,l:'_',g:'_'},fWa:{v:4.7,mn:0,mx:5,s:.1,l:'_',g:'_'},
fWs:{v:.16,mn:0,mx:1,s:.01,l:'_',g:'_'},
sCf:{v:4,mn:0,mx:30,s:.5,l:'_',g:'_'},sPr:{v:.5,mn:0,mx:1,s:.05,l:'_',g:'_'},
sDt:{v:.7,mn:0,mx:1,s:.05,l:'_',g:'_'},sCur:{v:0,mn:0,mx:15,s:.1,l:'_',g:'_'},
sNd:{v:20,mn:4,mx:40,s:1,l:'_',g:'_'},sSl:{v:2,mn:.1,mx:6,s:.1,l:'_',g:'_'},
sSp:{v:.85,mn:0,mx:3,s:.05,l:'_',g:'_'},sSub:{v:6,mn:1,mx:6,s:1,l:'_',g:'_'},
rHw:{v:19,mn:2,mx:30,s:1,l:'_',g:'_'},rCb:{v:.55,mn:0,mx:3,s:.05,l:'_',g:'_'},
rHb:{v:.11,mn:0,mx:1,s:.01,l:'_',g:'_'},rsc:{v:.85,mn:.25,mx:1,s:.05,l:'_',g:'_'},
cVal:{v:1,mn:0,mx:1,s:.01,l:'_',g:'_'},cHH:{v:.98,mn:0,mx:1,s:.01,l:'_',g:'_'},
cHT:{v:1,mn:0,mx:1,s:.05,l:'_',g:'_'},cHI:{v:.55,mn:0,mx:1,s:.05,l:'_',g:'_'},
cRS:{v:0,mn:0,mx:1,s:.01,l:'_',g:'_'},
mEnv:{v:0,mn:0,mx:1,s:.01,l:'_',g:'_'},mRough:{v:.35,mn:0,mx:1,s:.05,l:'_',g:'_'},
mBrush:{v:.15,mn:0,mx:1,s:.01,l:'_',g:'_'},
};
// Boolean toggles: the first three get checkboxes; the rest are baked-on.
const C_={
sSdf:{v:true,l:'Show SDF',g:'vis'},sFil:{v:true,l:'Show Filaments',g:'vis'},
sPause:{v:false,l:'Pause',g:'vis'},
sHalo:{v:true,l:'_',g:'_'},fObj:{v:true,l:'_',g:'_'},sWave:{v:true,l:'_',g:'_'},
};
const GROUPS=[
  {k:'color',l:'Color'},
  {k:'mat',l:'Material'},
  {k:'struct',l:'Structure'},
  {k:'vis',l:'Toggles'},
];
// Flatten the defs into live state: cur holds numbers, chk holds booleans.
const cur={};for(const[k,p]of Object.entries(P_))cur[k]=p.v;
const chk={};for(const[k,c]of Object.entries(C_))chk[k]=c.v;

// ═══════════════ WEBGL ═══════════════
// WebGL2 context on the one canvas; the page needs instancing and float work.
const canvas=document.getElementById('gl');
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false});
// The tab shell removes this iframe on a page swap. Drop the context so the
// browser does not run out of live WebGL contexts during heavy swapping.
window.addEventListener('pagehide',function(){try{if(gl)gl.getExtension('WEBGL_lose_context').loseContext();}catch(e){}});
// Compile + link a program from vertex and fragment source; log any error.
function mkP(vs,fs){const cs=(s,t)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);
  if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))console.error('SHADER ERR:',gl.getShaderInfoLog(o));return o;};
  const p=gl.createProgram();gl.attachShader(p,cs(vs,gl.VERTEX_SHADER));
  gl.attachShader(p,cs(fs,gl.FRAGMENT_SHADER));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))console.error('LINK ERR:',gl.getProgramInfoLog(p));return p;}
// Two programs: the SDF surface and the filament ribbons.
const sdfP=mkP(SDF_VS,SDF_FS),filP=mkP(FIL_VS,FIL_FS);
// Cache every uniform location for each program, keyed by name.
const sU={},fU={};
['u_res','u_time','u_ro','u_sR','u_pK','u_tO','u_tM','u_tm','u_cD','u_pM','u_rS','u_gP','u_gH','u_mode','u_filTex','u_vp','u_mBase','u_mMetal','u_mFres','u_mEnv','u_mRough','u_mBrush','u_rA','u_rB','u_rC','u_pulse','u_pulseR']
  .forEach(n=>sU[n]=gl.getUniformLocation(sdfP,n));
['u_vp','u_res','u_width','u_taper','u_eStep','u_rootHue','u_tipHue','u_sat','u_val','u_hotHue','u_hotThresh','u_hotInt','u_ringSpread','u_grad','u_bright','u_sdfDist','u_cam']
  .forEach(n=>fU[n]=gl.getUniformLocation(filP,n));
// The SDF pass draws a bare fullscreen triangle (no attributes). The filament
// pass is instanced: one instance per edge, six vertices making a ribbon quad.
// Each instance record is 32 bytes: endpoint A (vec3), endpoint B (vec3),
// along-length t (float), brightness (float); divisor 1 advances per instance.
const sdfVAO=gl.createVertexArray(),filVAO=gl.createVertexArray(),filBuf=gl.createBuffer();
gl.bindVertexArray(filVAO);gl.bindBuffer(gl.ARRAY_BUFFER,filBuf);const ST=32;
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,ST,0);gl.vertexAttribDivisor(0,1);
gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,ST,12);gl.vertexAttribDivisor(1,1);
gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,ST,24);gl.vertexAttribDivisor(2,1);
gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,1,gl.FLOAT,false,ST,28);gl.vertexAttribDivisor(3,1);
gl.bindVertexArray(null);

// ═══════════════ FBO for SDF distance texture ═══════════════
// Two offscreen targets, rebuilt on resize: distTex holds the SDF scene depth
// (nearest filtering, read for filament occlusion), filTex holds the rendered
// filaments (linear filtering, read as the surface reflection source).
let distTex,distFBO,filTex,filFBO;
function mkFBO(w,h){
  if(distTex)gl.deleteTexture(distTex);
  if(distFBO)gl.deleteFramebuffer(distFBO);
  distTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,distTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  distFBO=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,distFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,distTex,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  // Filament reflection texture (linear so reflections stay smooth).
  // Filament reflection texture
  if(filTex)gl.deleteTexture(filTex);
  if(filFBO)gl.deleteFramebuffer(filFBO);
  filTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,filTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  filFBO=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,filFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,filTex,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
}

// ═══════════════ FLOW FIELD ═══════════════
// The branched-flow velocity field a filament follows. It sums three fixed
// sinusoidal "gradient" directions (curl-noise style) at the sample point, each
// animated by time, then optionally adds a radial standing wave. This is what
// makes the filaments branch and braid instead of running straight.
function field3D(p,seed,time,C){
  const s1=seed*17,s2=seed*39,fr=C.fFr,fz=C.fFrZ;
  const q=[p[0]*fr,p[1]*fr,p[2]*fz];
  const a=[1.9,1.3,.7],b=[-1.1,2.7,-1.5],c=[.8,-2.1,3.3];
  const pa_=s1+time*.05*C.fMo,pb_=s2-time*.035*C.fMo,pc_=s1*1.7+time*.05;
  const sA=Math.sin(a[0]*q[0]+a[1]*q[1]+a[2]*q[2]+pa_);
  const sB=Math.sin(b[0]*q[0]+b[1]*q[1]+b[2]*q[2]+pb_);
  const sC=Math.sin(c[0]*q[0]+c[1]*q[1]+c[2]*q[2]+pc_);
  const F=[
    (a[0]*sA+b[0]*sB*C.fO2+c[0]*sC*C.fO3)*fr,
    (a[1]*sA+b[1]*sB*C.fO2+c[1]*sC*C.fO3)*fr,
    (a[2]*sA+b[2]*sB*C.fO2+c[2]*sC*C.fO3)*fz];
  if(chk.sWave){const r=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])+1e-6;
    const w=Math.sin(r*C.fWf-time*C.fWs+s1);
    F[0]+=p[0]/r*w*C.fWa;F[1]+=p[1]/r*w*C.fWa;F[2]+=p[2]/r*w*C.fWa;}
  return F;}

// ═══════════════ SEEDS + TRACING ═══════════════
// The global spin: build the animated rotation matrix and its transpose so the
// CPU trace and the shader agree on the scene's orientation over time.
function computeGRot(t,sp){const tm=t*sp;
  const g=mM3(rX3(cur.moRA*tm),mM3(rZ3(cur.moRB*tm),rY3(cur.moRC*tm)));
  return{R:tM3(g),Rt:g};}
// Torus radial offset, pulsing over time (matches the shader's carve motion).
function pOff(C,t){return C.tO+Math.sin(t*C.moPulseR)*C.moPulse;}
// Integer hash in [0,1): deterministic jitter for seed placement.
function jH(i){let x=Math.imul(i,2654435761)>>>0;x^=x>>>15;x=Math.imul(x,0x846ca68b)>>>0;return(x>>>8)/16777216;}
// Map a torus angle to a world position for one cube-corner sign octant.
function torusToWorld(theta,s,Rt,C,t){
  const tp=[C.tM*Math.cos(theta),0,C.tM*Math.sin(theta)];
  const off=pOff(C,t);
  let p=mV3(Rt,tp);p=[s[0]*(p[0]+off),s[1]*(p[1]+off),s[2]*(p[2]+off)];
  return mV3(Rt,mV3(Rt,p));}
// Build the filament start points: rings of seeds laid around tori attached to
// the eight cube-corner octants, jittered along and across the ring. Each seed
// carries its position, tangent, outward direction, and a per-seed noise seed.
function genSeeds(C,R,Rt,t){
  const seeds=[],
    ALL=[[-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1],[1,-1,-1],[1,-1,1],[1,1,-1],[1,1,1]];
  const nRings=Math.round(C.sRings),density=Math.round(C.sN),spread=C.sSp;
  for(let ring=0;ring<nRings;ring++){
    const sign=ALL[ring%8],layer=Math.floor(ring/8);
    const ea=layer*2.399;
    const eR=layer>0?mM3(rX3(ea*.7),rZ3(ea)):null;
    for(let i=0;i<density;i++){
      const jt=(jH(ring*10000+i*7+1)-.5)*spread*.04;
      const theta=(i/density+jt)*TAU;
      let pw=torusToWorld(theta,sign,Rt,C,t);
      let p1=torusToWorld(theta+.01,sign,Rt,C,t),p0=torusToWorld(theta-.01,sign,Rt,C,t);
      if(eR){pw=mV3(eR,pw);p1=mV3(eR,p1);p0=mV3(eR,p0);}
      const tn=nrm([p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]]);
      const ot=nrm(pw);
      const px=tn[1]*ot[2]-tn[2]*ot[1],py=tn[2]*ot[0]-tn[0]*ot[2],pz=tn[0]*ot[1]-tn[1]*ot[0];
      const pj=(jH(ring*10000+i*7+2)-.5)*spread*.4;
      pw=[pw[0]+px*pj,pw[1]+py*pj,pw[2]+pz*pj];
      seeds.push({pos:pw,tan:tn,out:ot,
        seed:theta*.1+i*.01+(sign[0]+sign[1]+sign[2])*.001+layer*.1});}}
  return seeds;}
// Integrate every seed into a polyline. At each node the velocity is nudged by
// the flow field, projected off the SDF gradient so filaments hug the surface,
// pulled toward or off the surface by distance, and given a curl swirl; the
// resulting node positions become the filament's points.
function traceAll(seeds,C,R,Rt,time){
  const nodes=Math.round(C.sNd),sub=Math.round(C.sSub),maxFils=2000;
  const step=C.sSl*C.tM*.03/sub;
  const gain=C.fGa*C.fCu*step;
  const oa=chk.fObj,cf=C.sCf,pr=C.sPr,dt=C.sDt,curS=C.sCur;
  const fils=[];
  for(const sd of seeds){
    if(fils.length>=maxFils)break;
    const v=[...sd.tan];
    const x=[...sd.pos];
    const pts=new Float32Array(nodes*3);
    pts[0]=x[0];pts[1]=x[1];pts[2]=x[2];
    let grad=[0,0,0];
    for(let j=1;j<nodes;j++){
      const along=j/(nodes-1);
      const cfj=cf*(1-along*dt);
      if(j%3===1||j===1)grad=torGrad(x,R,C,time);
      const dist=torDist(x,R,C,time);
      for(let s=0;s<sub;s++){
        const fp=oa?mV3(R,x):x;
        const F=field3D(fp,sd.seed,time,C);
        const fW=oa?mV3(Rt,F):F;
        // Remove the component along the surface normal so flow runs tangentially.
        if(pr>.01){const nd=grad[0]*fW[0]+grad[1]*fW[1]+grad[2]*fW[2];
          fW[0]-=nd*grad[0]*pr;fW[1]-=nd*grad[1]*pr;fW[2]-=nd*grad[2]*pr;}
        // Attract toward the surface (distance-proportional pull along -normal).
        const cd=Math.max(-5,Math.min(5,dist));
        if(cfj>.01){fW[0]-=cfj*cd*grad[0];fW[1]-=cfj*cd*grad[1];fW[2]-=cfj*cd*grad[2];}
        // Add a curl swirl about the axis toward the scene centre.
        if(curS>.01){const cx=-x[0],cy=-x[1],cz=-x[2];
          const cl=Math.sqrt(cx*cx+cy*cy+cz*cz)||1e-8;
          const tx=grad[1]*(cz/cl)-grad[2]*(cy/cl),ty=grad[2]*(cx/cl)-grad[0]*(cz/cl),tz=grad[0]*(cy/cl)-grad[1]*(cx/cl);
          const tl=Math.sqrt(tx*tx+ty*ty+tz*tz)||1e-8;
          fW[0]+=tx/tl*curS;fW[1]+=ty/tl*curS;fW[2]+=tz/tl*curS;}
        v[0]+=fW[0]*gain;v[1]+=fW[1]*gain;v[2]+=fW[2]*gain;
        const vl=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1e-8;
        v[0]/=vl;v[1]/=vl;v[2]/=vl;
        x[0]+=v[0]*step;x[1]+=v[1]*step;x[2]+=v[2]*step;}
      pts[j*3]=x[0];pts[j*3+1]=x[1];pts[j*3+2]=x[2];}
    fils.push(pts);}
  return fils;}
// Flatten the traced polylines into the instanced edge buffer: one 8-float
// record per edge (endpoint A, endpoint B, along-length t, tapering brightness).
function buildBuf(fils,nodes){const edges=nodes-1,tot=fils.length*edges;
  const buf=new Float32Array(tot*8);let off=0;
  for(const f of fils)for(let e=0;e<edges;e++){if((e+1)*3+2>=f.length)break;
    buf[off++]=f[e*3];buf[off++]=f[e*3+1];buf[off++]=f[e*3+2];
    buf[off++]=f[(e+1)*3];buf[off++]=f[(e+1)*3+1];buf[off++]=f[(e+1)*3+2];
    buf[off++]=e/(nodes-1);buf[off++]=1-.45*e/(nodes-1);}
  return{data:buf.subarray(0,off),count:off/8};}

// ═══════════════ CAMERA ═══════════════
// Orbit state: theta, phi, distance, plus a render-resolution scale. resize
// rebuilds the canvas and both FBOs to the scaled device resolution.
let resScale=.85,camT=.5,camP=.25,camD=55,drg=false,lmx,lmy;
function resize(){const d=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.floor(innerWidth*d*resScale);canvas.height=Math.floor(innerHeight*d*resScale);
  gl.viewport(0,0,canvas.width,canvas.height);mkFBO(canvas.width,canvas.height);}
addEventListener('resize',resize);resize();
// 1x1 red fallback occlusion texture: its red channel decodes to t=500, so with
// no depth pass every filament passes the occlusion test.
// 1x1 fallback: sdfT=500 → all filaments pass
const noOccTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,noOccTex);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,0,0,255]));

// ═══════════════ UI ═══════════════
// Build the control panel from P_/C_: one collapsible section per group, a
// slider per visible parameter and a checkbox per visible toggle, plus Shuffle
// (randomize a chosen subset), Reset (restore defaults), and a Time Scale row.
const pb=document.getElementById('pb');
function fmt(v){return Math.abs(v)>=10?v.toFixed(1):Math.abs(v)>=1?v.toFixed(2):v.toFixed(3);}
function buildUI(){pb.innerHTML='';
  for(const g of GROUPS){const d=document.createElement('div');d.className='gl';d.textContent=g.l;pb.appendChild(d);
    const gp=document.createElement('div');gp.className='gp';
    if(g.c){d.classList.add('collapsed');gp.classList.add('hidden');}
    d.onclick=()=>{d.classList.toggle('collapsed');gp.classList.toggle('hidden');};
    for(const[k,p]of Object.entries(P_)){if(p.g!==g.k)continue;
      const r=document.createElement('div');r.className='pr';
      const lb=document.createElement('label');lb.textContent=p.l;
      const inp=document.createElement('input');inp.type='range';inp.min=p.mn;inp.max=p.mx;inp.step=p.s;inp.value=cur[k];inp.id='p_'+k;
      const vl=document.createElement('span');vl.className='v';vl.id='v_'+k;vl.textContent=fmt(cur[k]);
      inp.oninput=()=>{cur[k]=parseFloat(inp.value);vl.textContent=fmt(cur[k]);if(k==='rsc'){resScale=cur[k];resize();}};
      r.append(lb,inp,vl);gp.appendChild(r);}
    for(const[k,c]of Object.entries(C_)){if(c.g!==g.k)continue;
      const r=document.createElement('div');r.className='cb';
      const inp=document.createElement('input');inp.type='checkbox';inp.checked=chk[k];inp.id='c_'+k;
      const lb=document.createElement('label');lb.textContent=c.l;lb.htmlFor='c_'+k;
      inp.onchange=()=>{chk[k]=inp.checked;};r.append(inp,lb);gp.appendChild(r);}
    pb.appendChild(gp);}
  const btns=document.createElement('div');
  // Shuffle randomizes only this curated subset (color, material, spin, density).
  const shuf=document.createElement('button');shuf.className='btn';shuf.textContent='Shuffle';
  shuf.onclick=()=>{const ks=['cRH','cTH','cSat','cGrad','gH','gP','mBase','mMetal','mFres','rS','moRA','moRB','moRC','sN','rCw'];
    for(const k of ks){const p=P_[k];if(!p)continue;
      cur[k]=Math.round((p.mn+Math.random()*(p.mx-p.mn))/p.s)*p.s;
      cur[k]=Math.max(p.mn,Math.min(p.mx,cur[k]));
      const el=document.getElementById('p_'+k);if(el){el.value=cur[k];document.getElementById('v_'+k).textContent=fmt(cur[k]);}}};
  // Reset restores every default value, toggle, and camera pose.
  const rst=document.createElement('button');rst.className='btn';rst.textContent='Reset';
  rst.onclick=()=>{for(const[k,p]of Object.entries(P_)){cur[k]=p.v;
    const el=document.getElementById('p_'+k);if(el){el.value=p.v;document.getElementById('v_'+k).textContent=fmt(p.v);}}
    for(const[k,c]of Object.entries(C_)){chk[k]=c.v;const el=document.getElementById('c_'+k);if(el)el.checked=c.v;}
    resScale=.85;camT=.5;camP=.25;camD=55;resize();};
  btns.append(shuf,rst);pb.appendChild(btns);
  // ── standalone Time Scale at bottom ──
  const tsd=document.createElement('div');tsd.className='pr';tsd.style.marginTop='8px';tsd.style.borderTop='1px solid rgba(90,110,200,0.15)';tsd.style.paddingTop='8px';
  const tsl=document.createElement('label');tsl.textContent='Time Scale';
  const tsi=document.createElement('input');tsi.type='range';tsi.min=0;tsi.max=3;tsi.step=0.05;tsi.value=cur.timeScale;tsi.id='p_timeScale';
  const tsv=document.createElement('span');tsv.className='v';tsv.id='v_timeScale';tsv.textContent=fmt(cur.timeScale);
  tsi.oninput=()=>{cur.timeScale=parseFloat(tsi.value);tsv.textContent=fmt(cur.timeScale);};
  tsd.append(tsl,tsi,tsv);pb.appendChild(tsd);}
buildUI();
// Panel header toggles the whole control panel open/closed.
document.getElementById('ph').onclick=()=>{const c=pb.classList.toggle('collapsed');
  document.getElementById('tog').textContent=c?'▶':'▼';};

// Input: drag orbits (theta/phi), wheel dollies, one-finger touch mirrors drag.
// Mouse
canvas.onmousedown=e=>{drg=true;lmx=e.clientX;lmy=e.clientY;canvas.style.cursor='grabbing';};
onmousemove=e=>{if(!drg)return;camT-=(e.clientX-lmx)*.005;camP+=(e.clientY-lmy)*.005;
  camP=Math.max(-1.45,Math.min(1.45,camP));lmx=e.clientX;lmy=e.clientY;};
onmouseup=()=>{drg=false;canvas.style.cursor='grab';};canvas.style.cursor='grab';
canvas.onwheel=e=>{camD*=1+e.deltaY*.001;camD=Math.max(25,Math.min(500,camD));e.preventDefault();};
canvas.ontouchstart=e=>{if(e.touches.length===1){drg=true;lmx=e.touches[0].clientX;lmy=e.touches[0].clientY;}e.preventDefault();};
canvas.ontouchmove=e=>{if(!drg||e.touches.length!==1)return;const tx=e.touches[0].clientX,ty=e.touches[0].clientY;
  camT-=(tx-lmx)*.005;camP+=(ty-lmy)*.005;camP=Math.max(-1.45,Math.min(1.45,camP));lmx=tx;lmy=ty;e.preventDefault();};
canvas.ontouchend=()=>{drg=false;};

// ═══════════════ RENDER ═══════════════
const infoEl=document.getElementById('info');
let fc=0,lt_=0,simTime=0,lastNow=0;

// Push all SDF-program uniforms for this frame: resolution, sim time, camera
// origin, torus/box shape, glow, material, and spin parameters.
function setSdfUniforms(ro){
  gl.uniform2f(sU.u_res,canvas.width,canvas.height);gl.uniform1f(sU.u_time,simTime);
  gl.uniform3f(sU.u_ro,ro[0],ro[1],ro[2]);
  gl.uniform1f(sU.u_sR,cur.sR);gl.uniform1f(sU.u_pK,cur.pK);gl.uniform1f(sU.u_tO,cur.tO);
  gl.uniform1f(sU.u_tM,cur.tM);gl.uniform1f(sU.u_tm,cur.tm);gl.uniform1f(sU.u_cD,cur.cD);
  gl.uniform1f(sU.u_pM,cur.pM);gl.uniform1f(sU.u_rS,cur.rS);gl.uniform1f(sU.u_gP,cur.gP);
  gl.uniform1f(sU.u_gH,cur.gH);
  gl.uniform1f(sU.u_mBase,cur.mBase);gl.uniform1f(sU.u_mMetal,cur.mMetal);
  gl.uniform1f(sU.u_mFres,cur.mFres);gl.uniform1f(sU.u_mEnv,cur.mEnv);
  gl.uniform1f(sU.u_mRough,cur.mRough);gl.uniform1f(sU.u_mBrush,cur.mBrush);
  gl.uniform1f(sU.u_rA,cur.moRA);gl.uniform1f(sU.u_rB,cur.moRB);gl.uniform1f(sU.u_rC,cur.moRC);
  gl.uniform1f(sU.u_pulse,cur.moPulse);gl.uniform1f(sU.u_pulseR,cur.moPulseR);}

// The frame loop: advance sim time, build the camera and shared view-projection
// matrix, trace filaments on the CPU, then run the four GPU passes.
function render(now){requestAnimationFrame(render);
  const dt=(now-lastNow)/1000;lastNow=now;if(!chk.sPause)simTime+=dt*cur.timeScale;
  fc++;if(now-lt_>1000){infoEl.textContent=Math.round(fc*1000/(now-lt_))+' fps';fc=0;lt_=now;}
  const ro=[camD*Math.sin(camT)*Math.cos(camP),camD*Math.sin(camP),camD*Math.cos(camT)*Math.cos(camP)];
  const W=canvas.width,H=canvas.height;

  // Compute VP matrix (shared by all passes)
  // The row negation flips handedness so the filament and SDF passes agree.
  const fovY=2*Math.atan(.5/Math.tan(PI/3)),asp=W/H;
  const vp=mM4(persp(fovY,asp,.1,1e3),lookAt(ro,[0,0,0],[0,1,0]));
  vp[0]*=-1;vp[4]*=-1;vp[8]*=-1;vp[12]*=-1;

  // CPU: trace filaments once, then upload the instanced edge buffer.
  // CPU: trace filaments once
  let filData=null,filCount=0,filN=0,nFils=0;
  if(chk.sFil){
    const{R,Rt}=computeGRot(simTime,cur.rS);
    const seeds=genSeeds(cur,R,Rt,simTime);
    const fils=traceAll(seeds,cur,R,Rt,simTime);
    nFils=fils.length;filN=Math.round(cur.sNd);
    const bb=buildBuf(fils,filN);filData=bb.data;filCount=bb.count;
    if(filCount>0){gl.bindBuffer(gl.ARRAY_BUFFER,filBuf);gl.bufferData(gl.ARRAY_BUFFER,filData,gl.DYNAMIC_DRAW);}
  }

  // Draw the filament ribbons additively, in two size passes (core then halo).
  // withOcclusion picks the real depth texture or the pass-all fallback.
  function drawFils(withOcclusion){
    gl.useProgram(filP);gl.bindVertexArray(filVAO);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    if(withOcclusion){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,distTex);gl.uniform1i(fU.u_sdfDist,0);}
    else{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,noOccTex);gl.uniform1i(fU.u_sdfDist,0);}
    gl.uniform3f(fU.u_cam,ro[0],ro[1],ro[2]);
    gl.uniformMatrix4fv(fU.u_vp,false,vp);gl.uniform2f(fU.u_res,W,H);
    gl.uniform1f(fU.u_taper,1.0);gl.uniform1f(fU.u_eStep,1/(filN-1));
    gl.uniform1f(fU.u_rootHue,cur.cRH);gl.uniform1f(fU.u_tipHue,cur.cTH);
    gl.uniform1f(fU.u_sat,cur.cSat);gl.uniform1f(fU.u_val,cur.cVal);
    gl.uniform1f(fU.u_hotHue,cur.cHH);gl.uniform1f(fU.u_hotThresh,cur.cHT);
    gl.uniform1f(fU.u_hotInt,cur.cHI);
    gl.uniform1f(fU.u_ringSpread,cur.cRS);gl.uniform1f(fU.u_grad,cur.cGrad);
    // Core
    gl.uniform1f(fU.u_bright,cur.rCb);gl.uniform1f(fU.u_width,cur.rCw);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,filCount);
    // Halo
    if(chk.sHalo){gl.uniform1f(fU.u_bright,cur.rHb);gl.uniform1f(fU.u_width,cur.rHw);
      gl.drawArraysInstanced(gl.TRIANGLES,0,6,filCount);}
    gl.disable(gl.BLEND);
  }

  // Pass 1: draw filaments unoccluded into filFBO; the SDF pass reflects it.
  // Pass 1: Filaments → filFBO (reflection source, no occlusion)
  if(chk.sFil&&filCount>0){
    gl.bindFramebuffer(gl.FRAMEBUFFER,filFBO);gl.viewport(0,0,W,H);
    gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
    drawFils(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);
  }

  // Pass 2: render the SDF depth (u_mode=1) into distFBO for filament occlusion.
  // Pass 2: SDF distance → distFBO
  gl.useProgram(sdfP);gl.bindVertexArray(sdfVAO);gl.disable(gl.BLEND);
  if(chk.sFil){
    gl.bindFramebuffer(gl.FRAMEBUFFER,distFBO);gl.viewport(0,0,W,H);
    gl.clearColor(1,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
    setSdfUniforms(ro);gl.uniform1f(sU.u_mode,1.0);
    gl.uniformMatrix4fv(sU.u_vp,false,vp);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);
  }

  // Pass 3: render the shaded SDF surface (u_mode=0) to screen, sampling filTex
  // as its reflection. If the surface is hidden, just clear to the background.
  // Pass 3: SDF color → screen (with filament reflection texture)
  if(chk.sSdf){
    gl.useProgram(sdfP);gl.bindVertexArray(sdfVAO);gl.disable(gl.BLEND);
    setSdfUniforms(ro);gl.uniform1f(sU.u_mode,0.0);
    gl.uniformMatrix4fv(sU.u_vp,false,vp);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,filTex);
    gl.uniform1i(sU.u_filTex,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }else{gl.clearColor(.02,.02,.04,1);gl.clear(gl.COLOR_BUFFER_BIT);}

  // Pass 4: draw filaments to screen, now occluded by the SDF depth texture.
  // Pass 4: Filaments → screen (with occlusion)
  if(chk.sFil&&filCount>0){drawFils(true);}

  // Append filament and edge counts to the FPS readout.
  if(chk.sFil)infoEl.textContent=(infoEl.textContent.split('|')[0].trim())+' | '+nFils+' fils '+filCount+' edges';
}
requestAnimationFrame(render);
})();
