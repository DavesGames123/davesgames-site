const canvas=document.getElementById('gl');
const stage=document.getElementById('stage');
const overlay=document.getElementById('pathOverlay');
const octx=overlay.getContext('2d');
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});

/* ---- state ---- */
const S={
  mode:'fly', playing:true,
  resScale:0.7, dprCap:1.5,
  camClock:0, morphClock:0, bakeMorph:0,
  morphSpeed:0.08, pathSpeed:0.4, moveSpeed:14,
  seed:0, seedAxis:0,
  // planned flight path
  loop:null, dist:0, bank:0, showPath:true, needPlan:true, planMorph:0, lastPlanMs:0, hoPos:[0,0,0], hoFwd:[0,0,0],
  // walk camera
  pos:[0,16,0], yaw:0.6, pitch:-0.15,
  // flythrough free-look offset (drag to rotate, Blender-style)
  lookYaw:0, lookPitch:0,
  keys:{}, dragging:false, lx:0, ly:0,
};
const U={
  uFreq:0.07, uOct:2, uHeight:22, uThresh:12, uSlope:0.06, uRegion:14,
  uClearR:2, uMorphAmt:1.1,
  uEdgeGlow:1.9, uEdgeW:0.07, uBaseBright:0.62, uSat:1.0, uDuotone:0,
  uBloom:0.2, uScan:0.12, uFog:0.02, uFocal:1.0, uMaxSteps:150,
};
let CW=2,CH=2,RW=2,RH=2;

/* ---- shaders ---- */
let VS='';

let SCENE_FS='';

let POST_FS='';

/* ════════ DATA FAUNA — GPU boid swarm that inhabits the voxel field ════════ */
let BOID_SIM_FS='';
let BOID_VS='';
let BOID_FS='';
/* ---- gl helpers ---- */
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s),src);}
  return s;}
function prog(fs){const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,VS));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));}
  return p;}

let sceneProg,postProg,vao,fbo,fboTex,fboW=0,fboH=0,floatRT=false;
function initGL(){
  if(!gl){const l=document.getElementById('ctrlLegend');if(l){l.style.display='block';l.textContent='WebGL2 not available in this browser';}return false;}
  floatRT = !!gl.getExtension('EXT_color_buffer_float');
  sceneProg=prog(SCENE_FS);
  postProg=prog(POST_FS);
  vao=gl.createVertexArray();
  // uniform locations
  sceneLoc={}; ['uRes','uRO','uRight','uUp','uFwd','uFocal','uMorphTime','uSeedVec','uRegion','uFreq','uHeight','uThresh','uSlope','uMorphAmt','uClearR','uOct','uMaxSteps','uEdgeGlow','uEdgeW','uBaseBright','uSat','uDuotone','uFog']
    .forEach(n=>sceneLoc[n]=gl.getUniformLocation(sceneProg,n));
  postLoc={}; ['uScene','uRes','uBloom','uScan','uScanOn'].forEach(n=>postLoc[n]=gl.getUniformLocation(postProg,n));
  return true;
}
let sceneLoc,postLoc;

function makeFBO(w,h){
  if(fbo){gl.deleteFramebuffer(fbo);gl.deleteTexture(fboTex);}
  fboTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,fboTex);
  const internal = floatRT ? gl.RGBA16F : gl.RGBA8;
  const type = floatRT ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,gl.RGBA,type,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  fbo=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,fboTex,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  fboW=w;fboH=h;
}

/* ---- vector helpers ---- */
const v=(x,y,z)=>[x,y,z];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
function smoothstep(a,b,x){x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x);}
// hold-then-snap: terrain holds frozen for most of a cycle, then rapidly morphs to the next state
function steppedMorph(phase){
  const cyclePeriod=1/Math.max(S.morphSpeed,1e-4);
  const snapFrac=Math.min(0.55, 1.8/cyclePeriod);   // ~1.8s snap regardless of cycle length
  const it=Math.floor(phase), ft=phase-it;
  return it + smoothstep(1.0-snapFrac, 1.0, ft);
}

// seed offset directions — randomize explores ONE OF THREE distinct axes through noise space
const SEED_DIRS=[[1.7,0.25,0.45],[0.4,1.55,0.6],[0.55,0.4,1.7]];
function seedVec(){ const d=SEED_DIRS[S.seedAxis]||SEED_DIRS[0]; return [S.seed*d[0], S.seed*d[1], S.seed*d[2]]; }

/* ════════ FLIGHT PLANNER — plots an obstacle-avoiding trajectory through the field ════════ */
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const fract=x=>x-Math.floor(x);
// density field ported from the shader so the planner can "see" the voxels it must avoid
function jhash13(px,py,pz){
  let x=fract(px*0.1031), y=fract(py*0.1031), z=fract(pz*0.1031);
  const d=x*(y+33.33)+y*(z+33.33)+z*(x+33.33);
  x+=d; y+=d; z+=d;
  return fract((x+y)*z);
}
function jvnoise(x,y,z){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const fx=x-ix,fy=y-iy,fz=z-iz;
  const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy),uz=fz*fz*(3-2*fz);
  const L=(a,b,t)=>a+(b-a)*t;
  const n000=jhash13(ix,iy,iz),   n100=jhash13(ix+1,iy,iz),   n010=jhash13(ix,iy+1,iz),   n110=jhash13(ix+1,iy+1,iz);
  const n001=jhash13(ix,iy,iz+1), n101=jhash13(ix+1,iy,iz+1), n011=jhash13(ix,iy+1,iz+1), n111=jhash13(ix+1,iy+1,iz+1);
  const x00=L(n000,n100,ux),x10=L(n010,n110,ux),x01=L(n001,n101,ux),x11=L(n011,n111,ux);
  return L(L(x00,x10,uy),L(x01,x11,uy),uz);
}
function densJS(x,y,z,morphT){
  const sv=seedVec();
  let qx=x*U.uFreq+sv[0], qy=y*U.uFreq+sv[1], qz=z*U.uFreq+sv[2];
  const m=U.uMorphAmt*morphT; qx+=0.5*m; qy+=1.0*m; qz+=0.4*m;
  let f=0,amp=0.5,fr=1.0,nrm=0;
  for(let i=0;i<U.uOct;i++){ f+=amp*jvnoise(qx*fr,qy*fr,qz*fr); nrm+=amp; fr*=2.02; amp*=0.5; }
  f/=Math.max(nrm,1e-4);
  return U.uHeight*f - U.uSlope*y - U.uThresh;
}
// normalized density gradient (points "uphill" into solid; we move against it toward open air)
function gradN(x,y,z,m){
  const e=1.6;
  return norm([ densJS(x+e,y,z,m)-densJS(x-e,y,z,m),
                densJS(x,y+e,z,m)-densJS(x,y-e,z,m),
                densJS(x,y,z+e,m)-densJS(x,y,z-e,m) ]);
}
// base circuit (2π-periodic closed loop)
function baseLoop(s){
  return [ 90*Math.sin(s) + 38*Math.sin(2*s+1.3) + 16*Math.sin(3*s+0.5),
           38 + 9*Math.sin(2*s+0.7) + 5*Math.sin(3*s),
           90*Math.cos(s) + 38*Math.cos(2*s+2.1) + 16*Math.cos(3*s+1.7) ];
}
// ELASTIC BAND: relax a closed loop into the open corridors of the CURRENT field.
// Each node feels: a smoothing pull (taut curve), repulsion away from solids — sampled at the
// node AND the mid-points to its neighbours so the smoothed spline itself clears walls — and a
// weak tether to the base route so it stays a coherent circuit instead of drifting off.
function planFlight(){
  const morphT = (S.mode==='fly') ? steppedMorph(S.morphClock) : S.bakeMorph;
  S.planMorph = morphT;
  const K=84, TAU=Math.PI*2, SAFE=4.5, ITERS=72, MX=3.2;
  const base=[], node=[];
  for(let k=0;k<K;k++){ const s=TAU*k/K; const p=baseLoop(s); base.push(p); node.push(p.slice()); }
  for(let it=0;it<ITERS;it++){
    const nx=[];
    for(let k=0;k<K;k++){
      const p=node[k], pm=node[(k-1+K)%K], pn=node[(k+1)%K], b=base[k];
      const lap=[(pm[0]+pn[0])*0.5-p[0], (pm[1]+pn[1])*0.5-p[1], (pm[2]+pn[2])*0.5-p[2]];
      let rx=0,ry=0,rz=0;
      const probes=[ p,
                     [(p[0]+pn[0])*0.5,(p[1]+pn[1])*0.5,(p[2]+pn[2])*0.5],
                     [(p[0]+pm[0])*0.5,(p[1]+pm[1])*0.5,(p[2]+pm[2])*0.5] ];
      for(const q of probes){
        const d=densJS(q[0],q[1],q[2],morphT);
        if(d>-SAFE){ const g=gradN(q[0],q[1],q[2],morphT); const push=d+SAFE; rx-=g[0]*push; ry-=g[1]*push; rz-=g[2]*push; }
      }
      let fx=lap[0]*0.50 + rx*0.82 + (b[0]-p[0])*0.009;
      let fy=lap[1]*0.50 + ry*0.82 + (b[1]-p[1])*0.018;
      let fz=lap[2]*0.50 + rz*0.82 + (b[2]-p[2])*0.009;
      const fl=Math.hypot(fx,fy,fz); if(fl>MX){ const s2=MX/fl; fx*=s2; fy*=s2; fz*=s2; }
      nx.push([p[0]+fx, p[1]+fy, p[2]+fz]);
    }
    for(let k=0;k<K;k++) node[k]=nx[k];
  }
  const prev=S.loop;                 // did we already have a route? (then this is a re-plan)
  const oldEye=camRO.slice(), oldFwd=camF.slice();
  buildLoop(node);
  // SEAMLESS HAND-OVER: re-anchor traversal to the camera's current position on the new loop, then
  // capture the residual offset so the camera starts exactly where it is and DRIFTS onto the route.
  if(prev && S.mode==='fly'){
    const Lp=S.loop; let best=1e18, bd=S.dist;
    for(let i=0;i<Lp.N;i++){ const q=Lp.pts[i]; const dx=q[0]-oldEye[0],dy=q[1]-oldEye[1],dz=q[2]-oldEye[2]; const dd=dx*dx+dy*dy+dz*dz; if(dd<best){best=dd; bd=Lp.cum[i];} }
    S.dist=bd;
    const hh=5.0, nb=loopPos(bd), nbE=[nb[0],nb[1]+3.0,nb[2]];
    const ta=loopPos(bd-hh), tb=loopPos(bd+hh), nbF=norm([tb[0]-ta[0],tb[1]-ta[1],tb[2]-ta[2]]);
    S.hoPos=[oldEye[0]-nbE[0], oldEye[1]-nbE[1], oldEye[2]-nbE[2]];
    S.hoFwd=[oldFwd[0]-nbF[0], oldFwd[1]-nbF[1], oldFwd[2]-nbF[2]];
  }
  S.needPlan=false; S.lastPlanMs=performance.now();
}
// Catmull-Rom through the closed waypoint list → dense arc-length-parameterised samples
function crom(p0,p1,p2,p3,t){
  const t2=t*t,t3=t2*t; const out=[0,0,0];
  for(let i=0;i<3;i++){
    out[i]=0.5*((2*p1[i])+(-p0[i]+p2[i])*t+(2*p0[i]-5*p1[i]+4*p2[i]-p3[i])*t2+(-p0[i]+3*p1[i]-3*p2[i]+p3[i])*t3);
  }
  return out;
}
function buildLoop(wp){
  const K=wp.length, SUB=12; const pts=[];
  for(let k=0;k<K;k++){
    const p0=wp[(k-1+K)%K],p1=wp[k],p2=wp[(k+1)%K],p3=wp[(k+2)%K];
    for(let j=0;j<SUB;j++) pts.push(crom(p0,p1,p2,p3,j/SUB));
  }
  const N=pts.length, cum=new Float64Array(N+1); cum[0]=0;
  for(let i=0;i<N;i++){ const a=pts[i],b=pts[(i+1)%N]; cum[i+1]=cum[i]+Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]); }
  S.loop={pts,cum,total:cum[N],N};
}
function loopPos(d){
  const Lp=S.loop; if(!Lp) return [0,38,0];
  let x=d%Lp.total; if(x<0)x+=Lp.total;
  // binary search the cumulative table
  let lo=0,hi=Lp.N;
  while(lo<hi){ const mid=(lo+hi)>>1; if(Lp.cum[mid+1]<x) lo=mid+1; else hi=mid; }
  const i=lo, seg=Lp.cum[i+1]-Lp.cum[i], f=seg>1e-6?(x-Lp.cum[i])/seg:0;
  const a=Lp.pts[i], b=Lp.pts[(i+1)%Lp.N];
  return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f];
}
function ensurePlan(){ if(S.needPlan || !S.loop) planFlight(); }


let camRO=[0,16,0], camR=[1,0,0], camU=[0,1,0], camF=[0,0,-1];
let lastDt=0.016;
function buildCamera(){
  if(S.mode==='fly'){
    ensurePlan();
    const d=S.dist, h=5.0;
    const p  = loopPos(d);
    const pa = loopPos(d-h), pb = loopPos(d+h);
    let vel=[pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]];          // velocity (tangent), includes climb/dive
    let fTarget=norm(vel);
    const eyeBase=[p[0], p[1]+3.0, p[2]];                    // exact eye, above the rail
    // hand-over drift: in normal flight the offsets are 0 (camera glued to the track). When the
    // route changes, an offset is captured so the camera doesn't jump, then it decays SLOWLY here —
    // a long, gentle drift onto the new track rather than a snap.
    const kd=Math.min(1, lastDt*0.7);
    S.hoPos=[S.hoPos[0]*(1-kd), S.hoPos[1]*(1-kd), S.hoPos[2]*(1-kd)];
    S.hoFwd=[S.hoFwd[0]*(1-kd), S.hoFwd[1]*(1-kd), S.hoFwd[2]*(1-kd)];
    const eye=[eyeBase[0]+S.hoPos[0], eyeBase[1]+S.hoPos[1], eyeBase[2]+S.hoPos[2]];
    let forward=norm([fTarget[0]+S.hoFwd[0], fTarget[1]+S.hoFwd[1], fTarget[2]+S.hoFwd[2]]);
    let right0=norm(cross(forward,[0,1,0])); if(!isFinite(right0[0])) right0=[1,0,0];
    let up0=cross(right0,forward);
    // lateral acceleration from path curvature → coordinated-turn bank (lean into the turn)
    const acc=[pb[0]-2*p[0]+pa[0], pb[1]-2*p[1]+pa[1], pb[2]-2*p[2]+pa[2]]; // ∝ curvature
    const latA=dot(acc,right0)/(h*h);
    let bankTarget=clamp(-9.0*latA, -0.7, 0.7);              // roll ONLY when actually turning
    // ease toward the target so banking feels like inertia, never a twitch
    S.bank += (bankTarget - S.bank)*Math.min(1, lastDt*3.2);
    const cb=Math.cos(S.bank), sb=Math.sin(S.bank);
    let right=[right0[0]*cb+up0[0]*sb, right0[1]*cb+up0[1]*sb, right0[2]*cb+up0[2]*sb];
    let up   =[up0[0]*cb-right0[0]*sb, up0[1]*cb-right0[1]*sb, up0[2]*cb-right0[2]*sb];
    // free-look offset still layers on top (drag to glance around)
    const ly=S.lookYaw, lp=S.lookPitch;
    if(ly||lp){
      const dl=[Math.sin(ly)*Math.cos(lp), Math.sin(lp), Math.cos(ly)*Math.cos(lp)];
      const fwd2=norm(add(add(mul(right,dl[0]),mul(up,dl[1])),mul(forward,dl[2])));
      const r2=norm(cross(fwd2,up)), u2=cross(r2,fwd2);
      forward=fwd2; right=r2; up=u2;
    }
    camRO=eye; camR=right; camU=up; camF=forward;
  } else {
    const cp=Math.cos(S.pitch), sp=Math.sin(S.pitch), cy=Math.cos(S.yaw), sy=Math.sin(S.yaw);
    const f=norm([cp*cy, sp, cp*sy]);
    const r=norm(cross(f,[0,1,0]));
    const u=cross(r,f);
    camRO=S.pos; camR=r; camU=u; camF=f;
  }
}

/* ---- resize ---- */
function resize(){
  CW=stage.clientWidth; CH=stage.clientHeight;
  if(CW<10||CH<10){CW=600;CH=400;}
  const dpr=Math.min(devicePixelRatio||1, S.dprCap);
  RW=Math.max(2,Math.round(CW*S.resScale*dpr));
  RH=Math.max(2,Math.round(CH*S.resScale*dpr));
  // pixel budget — keep the per-pixel raymarch tractable on 4K / retina
  const BUDGET=2600000;
  const tot=RW*RH;
  if(tot>BUDGET){ const k=Math.sqrt(BUDGET/tot); RW=Math.max(2,Math.round(RW*k)); RH=Math.max(2,Math.round(RH*k)); }
  canvas.width=RW; canvas.height=RH;
  canvas.style.width=CW+'px'; canvas.style.height=CH+'px';
  const odpr=Math.min(devicePixelRatio||1, 2);
  overlay.width=Math.max(2,Math.round(CW*odpr)); overlay.height=Math.max(2,Math.round(CH*odpr));
  overlay._dpr=odpr;
  if(gl) makeFBO(RW,RH);
}
if(window.ResizeObserver){new ResizeObserver(()=>resize()).observe(stage);}
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',()=>setTimeout(resize,120));
window.addEventListener('load',()=>setTimeout(resize,80));
if(document.fonts&&document.fonts.ready){document.fonts.ready.then(()=>resize());}

/* ---- trajectory overlay: project the planned path to screen, occluded by geometry ---- */
function pathOccluded(P,morphT){
  // march from the eye toward P; if the voxel CELL we pass is solid (what the renderer draws),
  // the point is hidden. Capped at ~96u — beyond that the fog hides everything regardless.
  const dx=P[0]-camRO[0], dy=P[1]-camRO[1], dz=P[2]-camRO[2];
  const dist=Math.hypot(dx,dy,dz); if(dist<1e-3) return false;
  const ux=dx/dist, uy=dy/dist, uz=dz/dist, step=1.0;
  const far=Math.min(dist-1.0, 96.0);
  for(let s=Math.max(step,U.uClearR+0.5); s<far; s+=step){
    const cx=Math.floor(camRO[0]+ux*s)+0.5, cy=Math.floor(camRO[1]+uy*s)+0.5, cz=Math.floor(camRO[2]+uz*s)+0.5;
    if(densJS(cx,cy,cz,morphT) > 0.0) return true;
  }
  return false;
}
// subtle Oblivion-radar-style HUD: trajectory readouts, reticle, corner brackets, scanning radar.
// original implementation (not a port) — low-alpha cyan, house mono type.
function drawHUD(ctx,W,H){
  const now=performance.now()*0.001;
  const C=a=>'rgba(150,232,248,'+a+')';
  ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.textBaseline='top'; ctx.textAlign='left';
  // corner brackets (bold)
  ctx.strokeStyle=C(0.55); ctx.lineWidth=1.6; const m=14,len=26;
  for(const [x,y,sx,sy] of [[m,m,1,1],[W-m,m,-1,1],[m,H-m,1,-1],[W-m,H-m,-1,-1]]){
    ctx.beginPath(); ctx.moveTo(x+sx*len,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*len); ctx.stroke();
  }
  ctx.font='10px "JetBrains Mono", monospace';
  ctx.fillStyle=C(0.50); ctx.fillText('STELLA NOVA \u00B7 VOXEL FIELD \u00B7 NAV', m+34, m-3);
  ctx.textAlign='right'; ctx.fillStyle=C(0.38); ctx.fillText('FRM '+(Math.floor(now*30)%100000), W-m-34, m-3); ctx.textAlign='left';
  // readout panel (top-left)
  const recomputing=(performance.now()-S.lastPlanMs)<800;
  const spd=(S.pathSpeed*10).toFixed(1);
  const hdg=((Math.atan2(camF[2],camF[0])*180/Math.PI+360)%360).toFixed(0).padStart(3,'0');
  const prog=S.loop?((S.dist%S.loop.total)/S.loop.total*100):0;
  const dots='.'.repeat(1+Math.floor(now*3)%3);
  ctx.fillStyle='rgba(8,16,24,0.34)'; ctx.fillRect(16,40,186,134);
  ctx.strokeStyle=C(0.32); ctx.lineWidth=1; ctx.strokeRect(16,40,186,134);
  ctx.fillStyle=C(0.88); ctx.font='bold 12px "JetBrains Mono", monospace'; ctx.fillText('\u25C8 TRAJECTORY SOLVER',24,49);
  ctx.font='11px "JetBrains Mono", monospace';
  ctx.fillStyle=C(0.50); ctx.fillText('STATUS',24,70);
  ctx.fillStyle=recomputing?'rgba(255,198,96,0.96)':C(0.82); ctx.fillText(recomputing?'RECOMPUTING'+dots:'LOCKED \u2713',88,70);
  const rows=[['VEL',spd+' u/s'],['HDG',hdg+'\u00B0'],['BANK',(S.bank*180/Math.PI).toFixed(0)+'\u00B0'],['POS',camRO[0].toFixed(0)+' '+camRO[1].toFixed(0)+' '+camRO[2].toFixed(0)]];
  let ty=88; for(const [k,v] of rows){ ctx.fillStyle=C(0.50); ctx.fillText(k,24,ty); ctx.fillStyle=C(0.84); ctx.fillText(v,88,ty); ty+=15; }
  ctx.fillStyle=C(0.50); ctx.fillText('TRACK',24,ty);
  ctx.strokeStyle=C(0.40); ctx.strokeRect(88,ty+2,104,7); ctx.fillStyle=C(0.58); ctx.fillRect(88,ty+2,104*prog/100,7);
  // centre ranging reticle
  const cx=W/2, cy=H/2;
  ctx.strokeStyle=C(0.42); ctx.lineWidth=1.4; ctx.beginPath();
  ctx.moveTo(cx-22,cy); ctx.lineTo(cx-8,cy); ctx.moveTo(cx+8,cy); ctx.lineTo(cx+22,cy);
  ctx.moveTo(cx,cy-22); ctx.lineTo(cx,cy-8); ctx.moveTo(cx,cy+8); ctx.lineTo(cx,cy+22); ctx.stroke();
  ctx.strokeStyle=C(0.30); ctx.lineWidth=1.2; const q=15;
  for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){ ctx.beginPath(); ctx.moveTo(cx+sx*q-sx*6,cy+sy*q); ctx.lineTo(cx+sx*q,cy+sy*q); ctx.lineTo(cx+sx*q,cy+sy*q-sy*6); ctx.stroke(); }
  ctx.fillStyle=C(0.55); ctx.beginPath(); ctx.arc(cx,cy,1.7,0,6.2832); ctx.fill();
  // scanning radar (bottom-right, large)
  const rx=W-88, ry=H-88, R=64;
  ctx.fillStyle='rgba(8,16,24,0.32)'; ctx.beginPath(); ctx.arc(rx,ry,R+9,0,6.2832); ctx.fill();
  ctx.strokeStyle=C(0.50); ctx.lineWidth=1.3;
  for(const rr of [R,R*0.66,R*0.33]){ ctx.beginPath(); ctx.arc(rx,ry,rr,0,6.2832); ctx.stroke(); }
  ctx.strokeStyle=C(0.42); ctx.lineWidth=2; const orot=now*0.4;
  for(let a=0;a<24;a+=2){ const a0=orot+a*Math.PI/12; ctx.beginPath(); ctx.arc(rx,ry,R+6,a0,a0+0.18); ctx.stroke(); }
  ctx.strokeStyle=C(0.34); ctx.lineWidth=1;
  for(let a=0;a<24;a++){ const an=a*Math.PI/12, lng=(a%6===0)?9:4; ctx.beginPath(); ctx.moveTo(rx+Math.cos(an)*(R-lng),ry+Math.sin(an)*(R-lng)); ctx.lineTo(rx+Math.cos(an)*R,ry+Math.sin(an)*R); ctx.stroke(); }
  ctx.strokeStyle=C(0.20); ctx.beginPath(); ctx.moveTo(rx-R,ry); ctx.lineTo(rx+R,ry); ctx.moveTo(rx,ry-R); ctx.lineTo(rx,ry+R); ctx.stroke();
  ctx.globalCompositeOperation='lighter';
  const sw=now*1.3;
  ctx.fillStyle=C(0.12); ctx.beginPath(); ctx.moveTo(rx,ry); ctx.arc(rx,ry,R,sw-0.9,sw); ctx.closePath(); ctx.fill();
  ctx.fillStyle=C(0.05); ctx.beginPath(); ctx.moveTo(rx,ry); ctx.arc(rx,ry,R,sw-1.9,sw-0.9); ctx.closePath(); ctx.fill();
  ctx.strokeStyle=C(0.88); ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx+Math.cos(sw)*R,ry+Math.sin(sw)*R); ctx.stroke();
  for(const ph of [0,2.1,4.3]){
    const px=rx+Math.cos(now*0.3+ph)*R*0.66, py=ry+Math.sin(now*0.42+ph)*R*0.5;
    ctx.fillStyle=C(0.72); ctx.beginPath(); ctx.arc(px,py,2.0,0,6.2832); ctx.fill();
  }
  ctx.fillStyle='rgba(255,110,80,'+(0.5+0.4*Math.sin(now*3)).toFixed(2)+')';
  ctx.beginPath(); ctx.arc(rx+Math.cos(now*0.25+4)*R*0.72, ry+Math.sin(now*0.33+1)*R*0.55, 2.6,0,6.2832); ctx.fill();
  ctx.globalCompositeOperation='source-over';
  ctx.font='9px "JetBrains Mono", monospace';
  ctx.fillStyle=C(0.62); ctx.fillText('\u25B8 SCAN ACTIVE',rx-R,ry-R-13);
  ctx.textAlign='right'; ctx.fillStyle=C(0.48); ctx.fillText('BRG '+hdg+'\u00B0',rx+R+8,ry-R-13);
  ctx.fillStyle=C(0.40); ctx.fillText('RNG 120u',rx+R+8,ry+R+4); ctx.textAlign='left';
  ctx.restore();
}
function drawPath(){
  const ctx=octx; if(!ctx) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,overlay.width,overlay.height);
  ctx.globalCompositeOperation='source-over';
  if(S.mode!=='fly') return;
  const odpr=overlay._dpr||1; ctx.setTransform(odpr,0,0,odpr,0,0);
  const W=CW,H=CH, focal=U.uFocal, morphT=steppedMorph(S.morphClock);
  function proj(P){
    const rel=[P[0]-camRO[0],P[1]-camRO[1],P[2]-camRO[2]];
    const vz=dot(rel,camF); if(vz<=0.1) return null;
    const ux=focal*dot(rel,camR)/vz, uy=focal*dot(rel,camU)/vz;
    return [(ux*H+W)/2, H-(uy*H+H)/2, vz];
  }
  if(S.showPath && S.loop){
    // TEN rails in five close pairs (slight lateral+vertical offset) → each reads as a thicker 3D rail
    const AHEAD=120, up=[0,1,0];
    const RAILS=[ [-2.75,0.22],[-2.42,-0.10], [-1.50,0.22],[-1.17,-0.10],
                  [-0.17,0.22],[0.17,-0.10],  [1.17,0.22],[1.50,-0.10],  [2.42,0.22],[2.75,-0.10] ];
    const NR=RAILS.length;
    const railSegs=RAILS.map(()=>[]), curR=RAILS.map(()=>[]); const ties=[];
    let s=-8, nextTie=0;
    while(s<=AHEAD){
      const P=loopPos(S.dist+s);
      const Pa=loopPos(S.dist+s-2.0), Pb=loopPos(S.dist+s+2.0);
      let lat=norm(cross(norm([Pb[0]-Pa[0],Pb[1]-Pa[1],Pb[2]-Pa[2]]), up));
      if(!isFinite(lat[0])) lat=[1,0,0];
      const vis = proj(P) && !pathOccluded(P,morphT);
      if(vis){
        const row=[];
        for(let r=0;r<NR;r++){
          const o=RAILS[r][0], vy=RAILS[r][1];
          const pr=proj([P[0]+lat[0]*o, P[1]+vy, P[2]+lat[2]*o]);
          if(pr){ curR[r].push(pr); row.push(pr); }
          else { if(curR[r].length>1)railSegs[r].push(curR[r]); curR[r]=[]; row.push(null); }
        }
        if(s>=nextTie){ ties.push(row); nextTie+=12; }
      } else {
        for(let r=0;r<NR;r++){ if(curR[r].length>1)railSegs[r].push(curR[r]); curR[r]=[]; }
        if(s>=nextTie) nextTie+=12;
      }
      s += Math.min(3.5, 0.4 + Math.max(0.0,s)*0.03);
    }
    for(let r=0;r<NR;r++) if(curR[r].length>1) railSegs[r].push(curR[r]);

    ctx.globalCompositeOperation='lighter'; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(110,205,235,0.20)'; ctx.lineWidth=1.1;
    for(const row of ties){
      ctx.beginPath(); let started=false;
      for(let r=0;r<row.length;r++){ const q=row[r]; if(!q){started=false;continue;} started?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); started=true; }
      ctx.stroke();
    }
    const layers=[
      {w:8.0,col:'rgba(64,176,206,0.07)'},
      {w:3.6,col:'rgba(104,216,238,0.15)'},
      {w:1.6,col:'rgba(176,242,255,0.52)'},
      {w:0.9,col:'rgba(236,253,255,0.92)'}
    ];
    for(const L of layers){
      ctx.lineWidth=L.w; ctx.strokeStyle=L.col;
      for(let r=0;r<NR;r++) for(const seg of railSegs[r]){
        ctx.beginPath();
        for(let i=0;i<seg.length;i++){ const q=seg[i]; i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation='source-over';
  }
  drawHUD(ctx,W,H);
}

/* ---- render ---- */
function draw(){
  if(!gl) return;
  buildCamera();
  const morphT = (S.mode==='fly') ? steppedMorph(S.morphClock) : S.bakeMorph;

  // pass 1 → scene fbo
  gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
  gl.viewport(0,0,RW,RH);
  gl.useProgram(sceneProg);
  gl.bindVertexArray(vao);
  gl.uniform2f(sceneLoc.uRes,RW,RH);
  gl.uniform3f(sceneLoc.uRO,camRO[0],camRO[1],camRO[2]);
  gl.uniform3f(sceneLoc.uRight,camR[0],camR[1],camR[2]);
  gl.uniform3f(sceneLoc.uUp,camU[0],camU[1],camU[2]);
  gl.uniform3f(sceneLoc.uFwd,camF[0],camF[1],camF[2]);
  gl.uniform1f(sceneLoc.uFocal,U.uFocal);
  gl.uniform1f(sceneLoc.uMorphTime,morphT);
  const sv=seedVec();
  gl.uniform3f(sceneLoc.uSeedVec,sv[0],sv[1],sv[2]);
  gl.uniform1f(sceneLoc.uRegion,U.uRegion);
  gl.uniform1f(sceneLoc.uFreq,U.uFreq);
  gl.uniform1f(sceneLoc.uHeight,U.uHeight);
  gl.uniform1f(sceneLoc.uThresh,U.uThresh);
  gl.uniform1f(sceneLoc.uSlope,U.uSlope);
  gl.uniform1f(sceneLoc.uMorphAmt,U.uMorphAmt);
  gl.uniform1f(sceneLoc.uClearR, S.mode==='fly' ? U.uClearR : 2.5);
  gl.uniform1i(sceneLoc.uOct,U.uOct);
  gl.uniform1i(sceneLoc.uMaxSteps,U.uMaxSteps);
  gl.uniform1f(sceneLoc.uEdgeGlow,U.uEdgeGlow);
  gl.uniform1f(sceneLoc.uEdgeW,U.uEdgeW);
  gl.uniform1f(sceneLoc.uBaseBright,U.uBaseBright);
  gl.uniform1f(sceneLoc.uSat,U.uSat);
  gl.uniform1i(sceneLoc.uDuotone,U.uDuotone);
  gl.uniform1f(sceneLoc.uFog,U.uFog);
  gl.drawArrays(gl.TRIANGLES,0,3);

  // pass 2 → screen
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.viewport(0,0,RW,RH);
  gl.useProgram(postProg);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,fboTex);
  gl.uniform1i(postLoc.uScene,0);
  gl.uniform2f(postLoc.uRes,RW,RH);
  gl.uniform1f(postLoc.uBloom,U.uBloom);
  gl.uniform1f(postLoc.uScan,U.uScan);
  gl.uniform1i(postLoc.uScanOn, document.getElementById('tog-scan').classList.contains('on')?1:0);
  gl.drawArrays(gl.TRIANGLES,0,3);
  // data fauna: step + draw the swarm over the composited scene (terrain-occluded via scene depth)
  if(BO.on){ if(S.playing) boidsStep(lastDt, morphT); boidsRender(); }
}

/* ---- walk update ---- */
function updateWalk(dt){
  const cp=Math.cos(S.pitch),sp=Math.sin(S.pitch),cy=Math.cos(S.yaw),sy=Math.sin(S.yaw);
  const f=norm([cp*cy,sp,cp*sy]);
  const r=norm(cross(f,[0,1,0]));
  let mv=[0,0,0];
  if(S.keys['w'])mv=add(mv,f); if(S.keys['s'])mv=sub(mv,f);
  if(S.keys['d'])mv=add(mv,r); if(S.keys['a'])mv=sub(mv,r);
  if(S.keys[' '])mv=add(mv,[0,1,0]); if(S.keys['shift'])mv=sub(mv,[0,1,0]);
  const l=Math.hypot(mv[0],mv[1],mv[2]);
  if(l>1e-4){mv=mul(mv,1/l);S.pos=add(S.pos,mul(mv,S.moveSpeed*dt));}
}

/* ---- loop ---- */
let last=0,fc=0,ft=0;
function loop(time){
  requestAnimationFrame(loop);
  const dt=Math.min((time-last)/1000,0.05); last=time; lastDt=dt;
  fc++;ft+=dt; if(ft>=0.5){document.getElementById('st-fps').textContent=Math.round(fc/ft)+' fps';fc=0;ft=0;}
  if(S.mode==='fly' && S.playing){
    const FLY_SPEED=10;
    S.dist += dt*S.pathSpeed*FLY_SPEED;
    S.morphClock += dt*S.morphSpeed;
    // Re-plan ONLY once the field has settled on a new configuration — never while it's mid-morph.
    // Re-planning during the shift re-anchors the camera onto a loop that's still changing, which
    // makes it lurch. Instead the camera keeps cruising the current trail through the whole
    // transition, then the route updates seamlessly once the geometry holds still again.
    const cm=steppedMorph(S.morphClock);
    if(Math.abs(cm-Math.round(cm))<1e-3 && Math.round(cm)!==Math.round(S.planMorph)) S.needPlan=true;
  }
  if(S.mode==='fly' && !S.dragging && (S.lookYaw||S.lookPitch)){
    const k=Math.max(0, 1 - dt*6.0);              // snap the gaze back to forward, fast
    S.lookYaw*=k; S.lookPitch*=k;
    if(Math.abs(S.lookYaw)<1e-3)S.lookYaw=0;
    if(Math.abs(S.lookPitch)<1e-3)S.lookPitch=0;
  }
  if(S.mode==='walk') updateWalk(dt);
  draw();
  drawPath();
  const p = (S.mode==='fly')?camRO:S.pos;
  document.getElementById('st-pos').textContent=`${p[0].toFixed(0)}, ${p[1].toFixed(0)}, ${p[2].toFixed(0)}`;
}

/* ---- controls ---- */
function sg(el){if(!el)return;const mn=+el.min,mx=+el.max;el.style.setProperty('--pct',((el.value-mn)/(mx-mn)*100)+'%');}
const PLAN_KEYS={uFreq:1,uOct:1,uHeight:1,uThresh:1,uSlope:1,uMorphAmt:1};
function setU(key,el,dp){U[key]=+el.value;const id='vl-'+el.id.slice(3);const o=document.getElementById(id);if(o)o.textContent=(+el.value).toFixed(dp);sg(el);if(PLAN_KEYS[key])S.needPlan=true;}
function setUi(key,el){U[key]=parseInt(el.value);const id='vl-'+el.id.slice(3);const o=document.getElementById(id);if(o)o.textContent=el.value;sg(el);if(key==='uMaxSteps')document.getElementById('st-steps').textContent=el.value;if(PLAN_KEYS[key])S.needPlan=true;}
function setF(key,el,dp){S[key]=+el.value;const id='vl-'+el.id.slice(3);const o=document.getElementById(id);if(o)o.textContent=(+el.value).toFixed(dp);sg(el);}
function setClear(el){U.uClearR=+el.value;document.getElementById('vl-clear').textContent=(+el.value).toFixed(0);sg(el);}
function setMorph(el){S.morphSpeed=+el.value;const v=+el.value;document.getElementById('vl-morph').textContent=(v<=0.0005)?'off':Math.round(1/v)+'s';sg(el);}
function setResScale(el){S.resScale=+el.value;document.getElementById('vl-resscale').textContent=(+el.value).toFixed(2);sg(el);resize();}
window.setU=setU;window.setUi=setUi;window.setF=setF;window.setClear=setClear;window.setResScale=setResScale;window.setMorph=setMorph;

function setMode(m){
  S.mode=m;
  document.getElementById('btn-fly').classList.toggle('active',m==='fly');
  document.getElementById('btn-walk').classList.toggle('active',m==='walk');
  document.getElementById('st-mode').textContent = m==='fly'?'flythrough':'explore';
  document.getElementById('walk-hint').style.display = m==='walk'?'block':'none';
  document.getElementById('row-speed').style.display = m==='walk'?'flex':'none';
  document.getElementById('row-cruise').style.display = m==='walk'?'none':'flex';
  stage.classList.toggle('explore',m==='walk');
  updateLegend();
  if(m==='walk'){
    // seed walk camera from current flythrough vantage + freeze the field
    S.bakeMorph=steppedMorph(S.morphClock);
    S.pos=camRO.slice();
    const f=norm(camF); S.yaw=Math.atan2(f[2],f[0]); S.pitch=Math.asin(Math.max(-1,Math.min(1,f[1])));
  }
}
window.setMode=setMode;
// on-screen control legend — clearly states WASD flight on desktop
function isDesktop(){ return window.matchMedia('(pointer:fine)').matches && window.innerWidth>980; }
function updateLegend(){
  const el=document.getElementById('ctrlLegend'); if(!el) return;
  if(!isDesktop()){ el.style.display='none'; return; }
  el.style.display='block';
  if(S.mode==='walk'){
    el.innerHTML='<span class="lg-t">WASD Flight — active</span>'+
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly &nbsp; <kbd>Space</kbd>/<kbd>Shift</kbd> up·down<br>'+
      '<span class="dim">click-drag to look · scroll to zoom · dbl-click to level</span>';
  } else {
    el.innerHTML='<span class="lg-t">Auto-flythrough</span>'+
      'click-drag to rotate the view · scroll to zoom · dbl-click recenter<br>'+
      '<span class="dim">press <kbd>⛶ WASD Fly</kbd> to pilot it yourself</span>';
  }
}
window.addEventListener('resize',updateLegend);
function togglePlay(){S.playing=!S.playing;const b=document.getElementById('btn-play');b.textContent=S.playing?'❚❚ Pause':'▶ Play';b.classList.toggle('active',S.playing);}
window.togglePlay=togglePlay;
const AXL=['X','Y','Z'];
function setSeed(el){S.seed=+el.value;const v=(+el.value).toFixed(1);document.getElementById('vl-seed').textContent=v;document.getElementById('st-seed').textContent=v+'·'+AXL[S.seedAxis];sg(el);S.needPlan=true;if(S.mode==='walk')S.bakeMorph=steppedMorph(S.morphClock);}
window.setSeed=setSeed;
function randomizeSeed(){S.seedAxis=Math.floor(Math.random()*3);const sl=document.getElementById('sl-seed');sl.value=(Math.random()*200).toFixed(1);setSeed(sl);}
window.randomizeSeed=randomizeSeed;
function rebake(){S.morphClock=Math.round(S.morphClock)+1+Math.floor(Math.random()*5);S.bakeMorph=steppedMorph(S.morphClock);S.needPlan=true;}
window.rebake=rebake;
function setPalette(d){U.uDuotone=d;document.getElementById('btn-pal-full').classList.toggle('active',d===0);document.getElementById('btn-pal-duo').classList.toggle('active',d===1);}
window.setPalette=setPalette;
function togScan(btn){btn.classList.toggle('on');}
window.togScan=togScan;
function togPath(btn){btn.classList.toggle('on');S.showPath=btn.classList.contains('on');}
window.togPath=togPath;

/* ---- pointer / keyboard ---- */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function applyDrag(dx,dy){
  const sens=0.005;
  if(S.mode==='walk'){
    S.yaw+=dx*sens; S.pitch=clamp(S.pitch-dy*sens,-1.553,1.553);
  } else {
    // free-look offset on the flythrough; clamp so the path stays roughly ahead
    S.lookYaw=clamp(S.lookYaw+dx*sens,-1.45,1.45);
    S.lookPitch=clamp(S.lookPitch-dy*sens,-1.2,1.2);
  }
}
canvas.addEventListener('mousedown',e=>{ if(e.button!==0)return; S.dragging=true; S.lx=e.clientX; S.ly=e.clientY; });
window.addEventListener('mouseup',()=>S.dragging=false);
window.addEventListener('mousemove',e=>{
  if(!S.dragging)return;
  applyDrag(e.clientX-S.lx, e.clientY-S.ly);
  S.lx=e.clientX; S.ly=e.clientY;
});
// double-click recenters the view
canvas.addEventListener('dblclick',()=>{ if(S.mode==='fly'){S.lookYaw=0;S.lookPitch=0;} else {S.pitch=0;} });
// scroll to zoom (FOV), Blender-style
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const sl=document.getElementById('sl-focal');
  const nf=clamp(U.uFocal + (e.deltaY<0?0.12:-0.12), +sl.min, +sl.max);
  U.uFocal=nf; sl.value=nf.toFixed(2);
  document.getElementById('vl-focal').textContent=nf.toFixed(2); sg(sl);
},{passive:false});
// touch: one-finger drag rotates
canvas.addEventListener('touchstart',e=>{ const t=e.touches[0]; S.dragging=true; S.lx=t.clientX; S.ly=t.clientY; e.preventDefault(); },{passive:false});
canvas.addEventListener('touchmove',e=>{ if(!S.dragging)return; const t=e.touches[0]; applyDrag(t.clientX-S.lx,t.clientY-S.ly); S.lx=t.clientX; S.ly=t.clientY; e.preventDefault(); },{passive:false});
window.addEventListener('touchend',()=>S.dragging=false);

window.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  const isMove = ['w','a','s','d',' '].includes(k) || k==='shift';
  if(isMove){
    if(S.mode!=='walk') setMode('walk');   // seamless takeover from the flythrough
    S.keys[k===' '?' ':k]=true;
    if(k===' ')e.preventDefault();
  }
});
window.addEventListener('keyup',e=>{
  const k=e.key.toLowerCase();
  if(['w','a','s','d',' '].includes(k)) S.keys[k===' '?' ':k]=false;
  if(k==='shift')S.keys['shift']=false;
});

/* ════════ boid swarm plumbing ════════ */
const BO={ W:280, N:280*280, speed:16, avoid:6, cling:0.4, cohesion:1.7, wander:0.2, glow:1.4, region:130,
  on:true, prog:null, pts:null, posT:[], velT:[], fbo:[], cur:0, loc:{}, ploc:{} };
function linkP(vsSrc,fsSrc){ const p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fsSrc)); gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); return p; }
function boidsInit(){
  if(!floatRT){ BO.on=false; const t=document.getElementById('tog-swarm'); if(t){ t.classList.remove('on'); t.textContent='✦ Swarm — float RT needed'; t.disabled=true; } return; }
  BO.prog=linkP(VS,BOID_SIM_FS);
  BO.pts =linkP(BOID_VS,BOID_FS);
  ['uPos','uVel','uW','uDt','uTime','uRO','uSeedVec','uFreq','uHeight','uThresh','uSlope','uMorphAmt','uMorphTime','uOct','uAvoid','uCling','uCohesion','uWander','uSpeed','uRegion'].forEach(k=>BO.loc[k]=gl.getUniformLocation(BO.prog,k));
  ['uPos','uVel','uW','uRO','uRight','uUp','uFwd','uFocal','uPoint','uRes','uDepth','uGlow','uFog','uTime'].forEach(k=>BO.ploc[k]=gl.getUniformLocation(BO.pts,k));
  const W=BO.W,N=BO.N, p0=new Float32Array(N*4), v0=new Float32Array(N*4);
  for(let i=0;i<N;i++){ const rx=Math.random()-0.5,ry=Math.random()-0.5,rz=Math.random()-0.5;
    p0[i*4]=rx*BO.region*1.5; p0[i*4+1]=38+ry*BO.region; p0[i*4+2]=rz*BO.region*1.5; p0[i*4+3]=Math.random()*15;
    v0[i*4]=rx; v0[i*4+1]=ry; v0[i*4+2]=rz; v0[i*4+3]=Math.random(); }
  const mk=data=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,W,W,0,gl.RGBA,gl.FLOAT,data);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT); return t; };
  BO.posT=[mk(p0),mk(p0)]; BO.velT=[mk(v0),mk(v0)]; BO.fbo=[gl.createFramebuffer(),gl.createFramebuffer()];
  for(let k=0;k<2;k++){ gl.bindFramebuffer(gl.FRAMEBUFFER,BO.fbo[k]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,BO.posT[k],0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,BO.velT[k],0); }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null); BO.cur=0;
  const c=document.getElementById('vl-bcount'); if(c)c.textContent=(N/1000).toFixed(0)+'k';
}
function boidsStep(dt,morphT){
  if(!BO.on||!BO.prog) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER,BO.fbo[1-BO.cur]);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
  gl.viewport(0,0,BO.W,BO.W); gl.disable(gl.BLEND);
  gl.useProgram(BO.prog); gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,BO.posT[BO.cur]); gl.uniform1i(BO.loc.uPos,0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,BO.velT[BO.cur]); gl.uniform1i(BO.loc.uVel,1);
  gl.uniform1f(BO.loc.uW,BO.W); gl.uniform1f(BO.loc.uDt,dt); gl.uniform1f(BO.loc.uTime,performance.now()*0.001);
  gl.uniform3f(BO.loc.uRO,camRO[0],camRO[1],camRO[2]);
  const sv=seedVec(); gl.uniform3f(BO.loc.uSeedVec,sv[0],sv[1],sv[2]);
  gl.uniform1f(BO.loc.uFreq,U.uFreq); gl.uniform1f(BO.loc.uHeight,U.uHeight); gl.uniform1f(BO.loc.uThresh,U.uThresh);
  gl.uniform1f(BO.loc.uSlope,U.uSlope); gl.uniform1f(BO.loc.uMorphAmt,U.uMorphAmt); gl.uniform1f(BO.loc.uMorphTime,morphT); gl.uniform1i(BO.loc.uOct,U.uOct);
  gl.uniform1f(BO.loc.uAvoid,BO.avoid); gl.uniform1f(BO.loc.uCling,BO.cling); gl.uniform1f(BO.loc.uCohesion,BO.cohesion);
  gl.uniform1f(BO.loc.uWander,BO.wander); gl.uniform1f(BO.loc.uSpeed,BO.speed); gl.uniform1f(BO.loc.uRegion,BO.region);
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null); BO.cur=1-BO.cur;
}
function boidsRender(){
  if(!BO.on||!BO.pts) return;
  gl.viewport(0,0,RW,RH);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
  gl.useProgram(BO.pts); gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,BO.posT[BO.cur]); gl.uniform1i(BO.ploc.uPos,0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,BO.velT[BO.cur]); gl.uniform1i(BO.ploc.uVel,1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,fboTex); gl.uniform1i(BO.ploc.uDepth,2);
  gl.uniform1f(BO.ploc.uW,BO.W);
  gl.uniform3f(BO.ploc.uRO,camRO[0],camRO[1],camRO[2]);
  gl.uniform3f(BO.ploc.uRight,camR[0],camR[1],camR[2]);
  gl.uniform3f(BO.ploc.uUp,camU[0],camU[1],camU[2]);
  gl.uniform3f(BO.ploc.uFwd,camF[0],camF[1],camF[2]);
  gl.uniform1f(BO.ploc.uFocal,U.uFocal); gl.uniform1f(BO.ploc.uPoint,42.0); gl.uniform2f(BO.ploc.uRes,RW,RH); gl.uniform1f(BO.ploc.uGlow,BO.glow);
  gl.uniform1f(BO.ploc.uFog,U.uFog); gl.uniform1f(BO.ploc.uTime,performance.now()*0.001);
  gl.drawArrays(gl.POINTS,0,BO.N);
  gl.disable(gl.BLEND);
}
function setB(key,el,dp){ BO[key]=+el.value; const o=document.getElementById('vl-'+el.id.slice(3)); if(o)o.textContent=(+el.value).toFixed(dp); sg(el); }
function togSwarm(btn){ if(btn.disabled)return; btn.classList.toggle('on'); BO.on=btn.classList.contains('on'); }
window.setB=setB; window.togSwarm=togSwarm;

/* ---- boot ---- */
async function boot(){
  VS = await (await fetch(new URL('shaders/fullscreen.vert.glsl', document.baseURI))).text();
  SCENE_FS = await (await fetch(new URL('shaders/scene.frag.glsl', document.baseURI))).text();
  POST_FS = await (await fetch(new URL('shaders/post.frag.glsl', document.baseURI))).text();
  BOID_SIM_FS = await (await fetch(new URL('shaders/boid-sim.frag.glsl', document.baseURI))).text();
  BOID_VS = await (await fetch(new URL('shaders/boid.vert.glsl', document.baseURI))).text();
  BOID_FS = await (await fetch(new URL('shaders/boid.frag.glsl', document.baseURI))).text();
  if(!initGL()){ return; }
  boidsInit();
  document.querySelectorAll('#rail input[type=range]').forEach(sg);
  document.getElementById('st-seed').textContent=S.seed.toFixed(1)+'\u00b7X';
  updateLegend();
  resize();
  requestAnimationFrame(loop);
}
setTimeout(boot,50);