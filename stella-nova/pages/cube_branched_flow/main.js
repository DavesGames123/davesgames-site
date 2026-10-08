// ============================================================================
//  CUBE SDF + BRANCHED FLOW  ·  ray-marched solid crossed with flowing filaments
// ----------------------------------------------------------------------------
//  Two renderers share one scene. A ray-marched signed-distance surface (a
//  central body, the rounded cube by default, with folded rings carved through
//  it) is the solid; thousands of
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
//      (flow.js) seed on the rings ─▶ step along velocity v:
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
//  CPU GEOMETRY lives in flow.js (DOM-free, also used by tests.mjs): body
//  shapes, ring fold, ring SDF, flow field, seeds, trace, the saver scenes
//  and the ring-intersecting checks. main.js imports it as F.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ---------------------------------------------------------------------------
//      shader load .......... "await fetch"        fetch .glsl before build
//      cpu geometry ......... "import(new URL"     flow.js as F
//      math ................. "MATH"               persp, lookAt, mM4
//      parameters ........... "const P_"           tunables and their metadata
//      shape + rings ........ "function setRings"  page Shape / Rings controls
//      webgl setup .......... "WEBGL"              programs, uniforms, VAOs
//      fbo .................. "function mkFBO"      distance + reflection targets
//      buffer build ......... "function buildBuf"   filaments -> instanced edges
//      camera ............... "let resScale"        orbit state + resize
//      ui ................... "function buildUI"    sliders, toggles, shuffle
//      input ................ "canvas.onmousedown"  drag / wheel / touch
//      render ............... "function render"     the four-pass frame loop
//      screensaver hook ..... "SCREENSAVER HOOK"     window.snSaver for the shell
// ============================================================================
(async () => {
// Shader source lives in real .glsl files. Fetch all four before building any
// program, so init runs in its original synchronous order.
const SDF_VS = await (await fetch(new URL('shaders/sdf.vert.glsl', document.baseURI))).text();
const SDF_FS = await (await fetch(new URL('shaders/sdf.frag.glsl', document.baseURI))).text();
const FIL_VS = await (await fetch(new URL('shaders/filament.vert.glsl', document.baseURI))).text();
const FIL_FS = await (await fetch(new URL('shaders/filament.frag.glsl', document.baseURI))).text();
// The CPU geometry (flow field, rings, body, trace, saver scenes) is the
// DOM-free module flow.js, shared with tests.mjs.
const F=await import(new URL('flow.js',document.baseURI).href);
const{PI,nrm}=F;

// ═══════════════ MATH ═══════════════
// persp and lookAt build the 4x4 projection and view matrices; mM4 multiplies
// them. The 3x3 kit for the trace is in flow.js.
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

// ═══════════════ PARAMETERS ═══════════════
// Visible controls — everything else baked. Spin params shuffle-only (no sliders).
// Each entry: v default, mn/mx range, s step, l label, g group. A group of '_'
// and a label of '_' mean the value has no slider (baked or shuffle-only).
// An entry with o (a list of [value, text]) gets a select, not a slider.
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
bShape:{v:0,mn:0,mx:F.BODIES.length-1,s:1,l:'Shape',g:'struct',o:F.BODIES.map((b,i)=>[i,b.l])},
sRings:{v:8,mn:1,mx:8,s:1,l:'Rings',g:'struct',o:F.RING_COUNTS.map(n=>[n,String(n)])},
// ── Shuffle-only (no UI, randomized by shuffle) ──
rS:{v:.5,mn:.1,mx:1.5,s:.05,l:'_',g:'_'},
moRA:{v:0,mn:0,mx:2,s:.01,l:'_',g:'_'},
moRB:{v:.5,mn:0,mx:2,s:.01,l:'_',g:'_'},
moRC:{v:.23,mn:0,mx:2,s:.01,l:'_',g:'_'},
// ── Locked (no UI, not shuffled) ──
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
['u_res','u_time','u_ro','u_ta','u_foc','u_shape','u_fold','u_sR','u_pK','u_tO','u_tM','u_tm','u_cD','u_pM','u_rS','u_gP','u_gH','u_mode','u_filTex','u_vp','u_mBase','u_mMetal','u_mFres','u_mEnv','u_mRough','u_mBrush','u_rA','u_rB','u_rC','u_pulse','u_pulseR']
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

// ═══════════════ SHAPE + RINGS ═══════════════
// The Rings control sets the ring count and lays the rings out with the page
// ring radius (F.PAGE_RR) and share (F.PAGE_B): 8 rings give the old tO 12,
// tM 10. The Shape control only picks the body; sdf.frag.glsl body() and
// F.bodyDist draw it.
function setRings(n){cur.sRings=n;Object.assign(cur,F.ringLayout(n,F.PAGE_RR,F.PAGE_B));}
// The fold mask uniform: 1 on each folded axis (see F.foldMask).
const foldOf=()=>F.foldMask(Math.round(cur.sRings));

// ═══════════════ BUFFER BUILD ═══════════════
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
// The page opens zoomed out so the whole cube and its filament rings fit the
// frame. A portrait viewport has a narrow horizontal view, so the distance
// grows by the inverse aspect there. Load and Reset use this distance.
function homeCamD(){return Math.min(500,135*Math.max(1,innerHeight/Math.max(1,innerWidth)));}
// camTa is the point the camera looks at. The orbit and the target move
// together, so a target off the origin pans the view (the saver uses it to
// put the body in the clear band of the label plate). It is 0 on the page.
// camF is the focal length in canvas heights: tan(60 deg) on the page, the
// fov that the SDF pass and persp() share. The saver changes it to frame.
let resScale=.85,camT=.5,camP=.25,camD=homeCamD(),camTa=[0,0,0],camF=Math.tan(PI/3),drg=false,lmx,lmy;
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
      if(p.o){const lb=document.createElement('label');lb.textContent=p.l;lb.htmlFor='p_'+k;
        const sel=document.createElement('select');sel.id='p_'+k;
        for(const[v,t]of p.o){const op=document.createElement('option');op.value=v;op.textContent=t;sel.appendChild(op);}
        sel.value=cur[k];
        sel.onchange=()=>{const v=parseFloat(sel.value);if(k==='sRings')setRings(v);else cur[k]=v;};
        r.append(lb,sel);gp.appendChild(r);continue;}
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
    const el=document.getElementById('p_'+k),vl=document.getElementById('v_'+k);if(el)el.value=p.v;if(vl)vl.textContent=fmt(p.v);}
    for(const[k,c]of Object.entries(C_)){chk[k]=c.v;const el=document.getElementById('c_'+k);if(el)el.checked=c.v;}
    resScale=.85;camT=.5;camP=.25;camD=homeCamD();resize();};
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
// origin, body shape and fold, ring shape, glow, material, and spin parameters.
function setSdfUniforms(ro){
  gl.uniform2f(sU.u_res,canvas.width,canvas.height);gl.uniform1f(sU.u_time,simTime);
  gl.uniform3f(sU.u_ro,ro[0],ro[1],ro[2]);gl.uniform3f(sU.u_ta,camTa[0],camTa[1],camTa[2]);gl.uniform1f(sU.u_foc,camF);
  const fo=foldOf();gl.uniform1i(sU.u_shape,Math.round(cur.bShape));gl.uniform3f(sU.u_fold,fo[0],fo[1],fo[2]);
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
  if(saverTick)saverTick(Math.min(dt,.1),now);
  fc++;if(now-lt_>1000){infoEl.textContent=Math.round(fc*1000/(now-lt_))+' fps';fc=0;lt_=now;}
  const ro=[camTa[0]+camD*Math.sin(camT)*Math.cos(camP),camTa[1]+camD*Math.sin(camP),camTa[2]+camD*Math.cos(camT)*Math.cos(camP)];
  const W=canvas.width,H=canvas.height;

  // Compute VP matrix (shared by all passes)
  // The row negation flips handedness so the filament and SDF passes agree.
  const fovY=2*Math.atan(.5/camF),asp=W/H;
  const vp=mM4(persp(fovY,asp,.1,1e3),lookAt(ro,camTa,[0,1,0]));
  vp[0]*=-1;vp[4]*=-1;vp[8]*=-1;vp[12]*=-1;

  // CPU: trace filaments once, then upload the instanced edge buffer.
  // CPU: trace filaments once
  let filData=null,filCount=0,filN=0,nFils=0;
  if(chk.sFil){
    const{R,Rt}=F.computeGRot(simTime,cur);
    const seeds=F.genSeeds(cur,R,Rt,simTime);
    const fils=F.traceAll(seeds,cur,R,Rt,simTime,chk);
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
// ═══════════════ SCREENSAVER HOOK ═══════════════
// The shell's screensaver (lib/screensaver.js) calls snSaver.enter(opts).
// The saver plays SHOTS of 6 to 12.5 s (longer at a high calm) with hard
// cuts. A seeded shuffle of SAVER_SHOTS sets the order, so each run is a new
// sequence.
// A shot sets the look (glow gP, metal, fold pK, carve cD) and a calm
// filament regime. F.saverScene (flow.js) maps the seed to the scene: the
// field and spin jitter, the body (F.BODIES), the ring count (1, 2, 4 or 8),
// the body size sR and a ring layout (tO, tM) with a start time. It keeps a
// layout only if every ring crosses the body over the whole shot
// (F.ringCheck). tests.mjs checks that every seeded scene also passes
// F.flowCheck (the filaments stay on the rings). Each shot also gets a
// palette, a camera angle, an orbit and a slow dolly.
// FRAMING. The body sits in the clear band of the label plate (plateBand,
// lib/saver-clear.js). The focal length camF makes the scene radius r
// (F.sceneRadius times the shot rk: the far body surface or ring edge) 0.5 of
// the band at a distance near 200, and camTa pans the view to the band
// centre. Macro has no fit: its camera is in the filaments.
// The dolly changes the distance by 16 % over a shot with camF fixed to the
// fit, so a push-in grows the body and a pull-out shrinks it.
const SAVER_LOOKS=[
  ['Indigo',  {cRH:.65,cTH:.56,cSat:1,  cGrad:.6, gH:.675}],
  ['Ember',   {cRH:.02,cTH:.11,cSat:1,  cGrad:.7, gH:.05}],
  ['Aurora',  {cRH:.36,cTH:.50,cSat:.9, cGrad:.8, gH:.45}],
  ['Orchid',  {cRH:.83,cTH:.95,cSat:.85,cGrad:.6, gH:.88}],
  ['Brass',   {cRH:.11,cTH:.53,cSat:.8, cGrad:.9, gH:.55}],
  ['Glacier', {cRH:.55,cTH:.60,cSat:.35,cGrad:.4, gH:.58}],
  ['Verdant', {cRH:.27,cTH:.17,cSat:.9, cGrad:.6, gH:.30}],
  ['Coral',   {cRH:.97,cTH:.58,cSat:.8, cGrad:1,  gH:.98}],
  ['Ultraviolet',{cRH:.75,cTH:.70,cSat:1, cGrad:.5, gH:.78}],
  ['Solar',   {cRH:.08,cTH:.15,cSat:.6, cGrad:.3, gH:.12}],
  ['Lagoon',  {cRH:.47,cTH:.62,cSat:1,  cGrad:.9, gH:.52}],
  ['Prism',   {cRH:0,  cTH:.66,cSat:.9, cGrad:1,  gH:.80}],
];
let saverTick=null;
window.snSaver={
  enter(opts){
    const calm=Math.min(1,Math.max(0,opts.calm??.7));
    ['panel','info'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
    let seed=(opts.seed>>>0)||1;
    const rnd=()=>{seed=Math.imul(seed^seed>>>15,0x2c1b3c6d)+0x6d2b79f5>>>0;seed^=seed>>>12;return(seed>>>0)/4294967296;};
    let band=null,bandAt=-1e9,plateBand=null;
    import('../../lib/saver-clear.js').then(m=>{plateBand=m.plateBand;}).catch(()=>{});
    // The clear band in CSS px: its height and width, and the offset of its
    // centre from the canvas centre (down is +).
    const bandBox=()=>{const h=innerHeight,w=innerWidth;
      if(!band)return{h:h*.9,w,oy:0};
      const t=Math.min(band.t,h*.42),b=Math.min(band.b,h*.42);
      return{h:Math.max(80,h-t-b),w:band.w?Math.min(w,band.w):w,oy:(t-b)/2};};
    let order=[],shot=null,li=0;
    const nextShot=()=>{
      if(!order.length){
        order=F.SAVER_SHOTS.map((_,i)=>i);
        for(let i=order.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
        if(shot&&order[0]===shot.i)order.push(order.shift());
      }
      const i=order.shift();
      for(const[k,p]of Object.entries(P_))cur[k]=p.v;
      // A palette, turned by up to 0.08 of the hue circle. Half the shots
      // take a tip hue across the circle from the root hue.
      li=Math.floor(rnd()*SAVER_LOOKS.length);
      const look={...SAVER_LOOKS[li][1]},turn=.16*rnd()-.08;
      for(const k of['cRH','cTH','gH'])look[k]=((look[k]+turn)%1+1)%1;
      if(rnd()<.5){look.cTH=(look.cRH+.35+.15*rnd())%1;look.cGrad=1;}
      Object.assign(cur,look);
      const sc=F.saverScene(rnd,i,calm,cur);
      Object.assign(cur,sc.C);
      simTime=sc.simTime;
      camT=6.2832*rnd();camP=-.3+.9*rnd();
      const r=sc.r;
      shot={i,name:sc.name,r,t:0,dur:sc.dur,
        orbit:(.08-.04*calm)*(.6+.4*rnd())*(rnd()<.5?-1:1),
        rise:(rnd()-.5)*.03,
        // dolly: the distance goes from 1 to k over the shot.
        k:rnd()<.5?.84:1.16,
        macro:r?0:40+15*rnd()};
      plate();
    };
    // The focal length that makes the body radius f of the band. A body of
    // radius r at distance d is camF r / d canvas heights tall (sdf.frag.glsl
    // and persp() share camF). The distance stays near 200, inside the march
    // range (MD 500 in sdf.frag.glsl), and the lens does the framing.
    const fitF=(r,d)=>{const bx=bandBox(),H=innerHeight,f=.5;
      return Math.min(f*bx.h,f*bx.w)*d/(r*H);};
    const label=typeof opts.label==='function'?opts.label:null;
    // The plate: field3D with the live frequencies and gains. q is p scaled
    // by fFr (fFrZ on z); a, b, c are the three fixed wave vectors.
    const plate=()=>{
      if(!label||!shot)return;
      const f=(v,d=2)=>Number(v).toFixed(d);
      label({
        title:'Branched flow · '+shot.name,
        sub:SAVER_LOOKS[li][0]+' · '+F.BODIES[Math.round(cur.bShape)].l+' · '+Math.round(cur.sRings)+(cur.sRings>1?' rings':' ring')+' · filaments traced through a sinusoidal field over a carved SDF body',
        tex:[String.raw`\vec F(\vec p)=-\nabla\bigl[\cos(\vec a\cdot\vec q)+g_2\cos(\vec b\cdot\vec q)+g_3\cos(\vec c\cdot\vec q)\bigr]`,
          String.raw`\vec v\leftarrow\vec v+\vec F-(\vec v\cdot\hat n)\,\hat n,\qquad \vec q=(f\,x,\;f\,y,\;f_z\,z)`],
        eq:['F(p) = −∇[cos(a·q) + g₂ cos(b·q) + g₃ cos(c·q)]','v ← v + F − (v·n̂) n̂,  q = (f x, f y, f_z z)'],
        params:[
          {sym:'f',name:'field frequency',value:f(cur.fFr)},
          {sym:'f_z',name:'z frequency',value:f(cur.fFrZ)},
          {sym:'g_2',name:'second wave',value:f(cur.fO2)},
          {sym:'g_3',name:'third wave',value:f(cur.fO3)},
          {sym:'N',name:'seed density',value:String(Math.round(cur.sN))},
        ],
      });
    };
    nextShot();
    saverTick=(dt,now)=>{
      if(plateBand&&now-bandAt>500){bandAt=now;band=plateBand(innerHeight);}
      shot.t+=dt;
      if(shot.t>shot.dur)nextShot();
      const s=Math.min(1,shot.t/shot.dur),e=s*s*(3-2*s);
      camT+=shot.orbit*dt;camP=Math.max(-.6,Math.min(.8,camP+shot.rise*dt));
      camD=(shot.macro||200)*(1+(shot.k-1)*e);
      camF=shot.macro?Math.tan(PI/3):fitF(shot.r,200);
      // Pan to the band centre: move the orbit and its target together along
      // the camera up vector. oy CSS px down is oy / H canvas heights, which
      // is camF delta / d at the target.
      const bx=bandBox(),o=[Math.sin(camT)*Math.cos(camP),Math.sin(camP),Math.cos(camT)*Math.cos(camP)];
      const ww=[-o[0],-o[1],-o[2]],uu=nrm([ww[2],0,-ww[0]]);
      const vv=[ww[1]*uu[2]-ww[2]*uu[1],ww[2]*uu[0]-ww[0]*uu[2],ww[0]*uu[1]-ww[1]*uu[0]];
      const dl=bx.oy*camD/(camF*innerHeight);
      camTa=[vv[0]*dl,vv[1]*dl,vv[2]*dl];
    };
    this._plate=setInterval(plate,1000);
    return{canvas,warmupMs:1500};
  },
  exit(){saverTick=null;clearInterval(this._plate);camTa=[0,0,0];camF=Math.tan(PI/3);},
};
requestAnimationFrame(render);
})();
