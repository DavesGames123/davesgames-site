// ============================================================================
//  flow.js  ·  DOM-free scene geometry for the cube SDF + branched flow page
// ----------------------------------------------------------------------------
//  This module holds the CPU half of the scene. main.js imports it for the
//  filament trace and the saver. tests.mjs imports it to check the saver
//  ranges in node. It has no DOM, no WebGL and no global state.
//
//  THE SCENE
//      body    the central shape (BODIES, index C.bShape). The default is the
//              rounded cube s8. sdf.frag.glsl body() is the GPU copy.
//      rings   tori that the space fold copies. The fold mirrors the folded
//              axes (foldMask), so the ring count is 1, 2, 4 or 8 (C.sRings).
//              Each ring centre sits at distance tO on each folded axis. The
//              rings carve the body and the filaments start on them.
//      flow    filaments seeded on the rings and traced through field3D.
//
//  THE RING-INTERSECTING REGIME   (ringCheck, flowCheck)
//      ringCheck   each ring centre line goes at least 0.05 sR into the body
//                  and 0.05 sR out of it, at every time of a shot.
//      flowCheck   the traced filaments stay near the rings: most filament
//                  nodes are within a band of the ring tube, and the mean
//                  turn per node stays small (no zigzag).
//      saverScene  draws a scene from the seed in the derived ranges and
//                  keeps only a scene that passes both (with margins).
//
//  SECTION MAP   (grep -n "<anchor>" flow.js)
//      math ................. "MATH"
//      body shapes .......... "BODIES"          shape list + bodyDist + bodyRadii
//      rings ................ "RINGS"           foldMask, ringSigns, ringLayout
//      ring sdf ............. "TORUS SDF"       torDist, torGrad
//      flow field ........... "function field3D"
//      seeds + trace ........ "function genSeeds", "function traceAll"
//      checks ............... "CHECKS"          ringCheck, flowCheck
//      saver scenes ......... "SAVER SCENES"    SAVER_SHOTS, saverScene
// ============================================================================

// ═══════════════ MATH ═══════════════
// rX3/rY3/rZ3 make 3x3 axis rotations, mM3/mV3 multiply, tM3 transposes, nrm
// normalizes. The matrices are row-major arrays of 9.
export const PI=Math.PI,TAU=PI*2;
export function rX3(a){const c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,c,-s,0,s,c];}
export function rY3(a){const c=Math.cos(a),s=Math.sin(a);return[c,0,-s,0,1,0,s,0,c];}
export function rZ3(a){const c=Math.cos(a),s=Math.sin(a);return[c,-s,0,s,c,0,0,0,1];}
export function mM3(a,b){const r=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++)
  r[i*3+j]=a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j];return r;}
export function mV3(m,v){return[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],
  m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];}
export function tM3(m){return[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];}
export function nrm(v){const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1e-8;return[v[0]/l,v[1]/l,v[2]/l];}

// ═══════════════ BODIES ═══════════════
// The central shape. The index is the u_shape uniform in sdf.frag.glsl, so
// keep this order in step with body() there. k scales sR to the shape size.
// rMin and rMax are the nearest and farthest surface points from the centre,
// in units of sR: the ring layout aims between them.
export const BODIES=[
  {k:'cube',     l:'Cube',       rMin:1,    rMax:Math.pow(3,3/8)},   // L8 ball
  {k:'sphere',   l:'Sphere',     rMin:1.2,  rMax:1.2},
  {k:'octa',     l:'Octahedron', rMin:1.8/Math.sqrt(3), rMax:1.8},  // L1 ball
  {k:'cylinder', l:'Cylinder',   rMin:1.05, rMax:1.05*Math.SQRT2},
  {k:'pillow',   l:'Pillow',     rMin:1.05, rMax:1.05*Math.pow(3,1/4)}, // L4 ball
];
// Signed distance (a bound) to the body, in the body frame. This is the CPU
// copy of body() in sdf.frag.glsl.
export function bodyDist(p,C){const r=C.sR,s=Math.round(C.bShape)|0;
  const ax=Math.abs(p[0]),ay=Math.abs(p[1]),az=Math.abs(p[2]);
  if(s===1)return Math.hypot(p[0],p[1],p[2])-1.2*r;
  if(s===2)return(ax+ay+az-1.8*r)*.57735027;
  if(s===3){const h=1.05*r,dx=Math.hypot(p[0],p[2])-h,dy=ay-h;
    return Math.min(Math.max(dx,dy),0)+Math.hypot(Math.max(dx,0),Math.max(dy,0));}
  if(s===4)return Math.pow(ax**4+ay**4+az**4,.25)-1.05*r;
  return Math.pow(ax**8+ay**8+az**8,.125)-r;}
export function bodyRadii(C){const b=BODIES[Math.round(C.bShape)|0]||BODIES[0];
  return{min:b.rMin*C.sR,max:b.rMax*C.sR};}

// ═══════════════ RINGS ═══════════════
// RING_COUNTS are the counts the fold can make. foldMask gives the folded
// axes for a count: 8 folds x, y and z, 4 folds x and y, 2 folds x, 1 folds
// none (one ring at the centre). ringSigns lists the octant sign of each ring,
// in the old 8-ring order, so the default seeds do not change.
export const RING_COUNTS=[1,2,4,8];
export function foldMask(n){return n>=8?[1,1,1]:n>=4?[1,1,0]:n>=2?[1,0,0]:[0,0,0];}
const ALL=[[-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1],[1,-1,-1],[1,-1,1],[1,1,-1],[1,1,1]];
export function ringSigns(n){const m=foldMask(n);
  return ALL.filter(s=>(m[0]||s[0]>0)&&(m[1]||s[1]>0)&&(m[2]||s[2]>0));}
// Ring layout from two shape numbers. rr is the distance from the centre to a
// ring point when the ring plane is normal to the centre direction:
// rr^2 = d^2 + tM^2, where d = tO sqrt(folded axes) is the ring centre
// distance. b = tM / rr. One ring (no fold) has d 0, so tM = rr.
// The page default rr 23.07, b 0.4334 gives tO 12, tM 10 for 8 rings.
export const PAGE_RR=Math.sqrt(3*144+100),PAGE_B=10/PAGE_RR;
export function ringLayout(n,rr,b){const m=foldMask(n),k=m[0]+m[1]+m[2];
  if(!k)return{tO:0,tM:rr};
  const tM=b*rr,d=Math.sqrt(Math.max(0,rr*rr-tM*tM));
  return{tO:d/Math.sqrt(k),tM};}

// ═══════════════ TORUS SDF ═══════════════
// pmF is a smooth-min, paF a smooth-abs (a rounded mirror fold). torDist is
// the signed distance to the folded rings, the CPU copy of d1 in df() of
// sdf.frag.glsl. torGrad is its numeric gradient (the ring normal).
export function pmF(a,b,k){const h=Math.max(0,Math.min(1,.5+.5*(b-a)/k));return b+(a-b)*h-k*h*(1-h);}
export function paF(a,k){return -pmF(a,-a,k);}
// Ring offset, pulsed over time (the same motion as the shader carve).
export function pOff(C,t){return C.tO+Math.sin(t*C.moPulseR)*C.moPulse;}
export function torDist(wp,R,C,t){
  let p=mV3(R,wp);p=mV3(R,p);
  const m=foldMask(Math.round(C.sRings)),off=pOff(C,t);
  p=[m[0]?paF(p[0],C.pK)-off:p[0],m[1]?paF(p[1],C.pK)-off:p[1],m[2]?paF(p[2],C.pK)-off:p[2]];
  p=mV3(R,p);
  const q=Math.sqrt(p[0]*p[0]+p[2]*p[2])-C.tM;
  return Math.sqrt(q*q+p[1]*p[1])-C.tm;}
export function torGrad(wp,R,C,t){const e=.02,d0=torDist(wp,R,C,t);
  return nrm([torDist([wp[0]+e,wp[1],wp[2]],R,C,t)-d0,
    torDist([wp[0],wp[1]+e,wp[2]],R,C,t)-d0,torDist([wp[0],wp[1],wp[2]+e],R,C,t)-d0]);}

// The global spin: the rotation and its transpose at time t, so the trace and
// the shader agree. R is gR transposed; the body frame of a world point wp is
// R wp (p*=gR in sdf.frag.glsl).
export function computeGRot(t,C){const tm=t*C.rS;
  const g=mM3(rX3(C.moRA*tm),mM3(rZ3(C.moRB*tm),rY3(C.moRC*tm)));
  return{R:tM3(g),Rt:g};}

// ═══════════════ FLOW FIELD ═══════════════
// The branched-flow velocity field. It sums three fixed sinusoidal gradient
// directions at the sample point, each animated by time, then adds a radial
// standing wave if wave is on. This field makes the filaments branch.
export function field3D(p,seed,time,C,wave){
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
  if(wave){const r=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])+1e-6;
    const w=Math.sin(r*C.fWf-time*C.fWs+s1);
    F[0]+=p[0]/r*w*C.fWa;F[1]+=p[1]/r*w*C.fWa;F[2]+=p[2]/r*w*C.fWa;}
  return F;}

// ═══════════════ SEEDS + TRACE ═══════════════
// Integer hash in [0,1): the jitter of the seed placement.
export function jH(i){let x=Math.imul(i,2654435761)>>>0;x^=x>>>15;x=Math.imul(x,0x846ca68b)>>>0;return(x>>>8)/16777216;}
// A ring angle to a world point, for the ring with octant sign s. This is
// the inverse of torDist: an unfolded axis has sign +1 and offset 0.
export function torusToWorld(theta,s,Rt,C,t){
  const m=foldMask(Math.round(C.sRings));
  const tp=[C.tM*Math.cos(theta),0,C.tM*Math.sin(theta)];
  const off=pOff(C,t);
  let p=mV3(Rt,tp);p=[s[0]*(p[0]+off*m[0]),s[1]*(p[1]+off*m[1]),s[2]*(p[2]+off*m[2])];
  return mV3(Rt,mV3(Rt,p));}
// Seeds per ring. Fewer rings get more seeds each (density x sqrt(8/n)), so
// the picture keeps a similar weight. 8 rings keep the density value.
export function seedsPerRing(C){const n=ringSigns(Math.round(C.sRings)).length;
  return Math.round(C.sN*Math.sqrt(8/n));}
// The filament start points: seeds around each ring, jittered along and
// across the ring. Each seed has a position, tangent, outward direction and a
// noise seed.
export function genSeeds(C,R,Rt,t){
  const seeds=[],signs=ringSigns(Math.round(C.sRings));
  const density=seedsPerRing(C),spread=C.sSp;
  for(let ring=0;ring<signs.length;ring++){
    const sign=signs[ring];
    for(let i=0;i<density;i++){
      const jt=(jH(ring*10000+i*7+1)-.5)*spread*.04;
      const theta=(i/density+jt)*TAU;
      let pw=torusToWorld(theta,sign,Rt,C,t);
      const p1=torusToWorld(theta+.01,sign,Rt,C,t),p0=torusToWorld(theta-.01,sign,Rt,C,t);
      const tn=nrm([p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]]);
      const ot=nrm(pw);
      const px=tn[1]*ot[2]-tn[2]*ot[1],py=tn[2]*ot[0]-tn[0]*ot[2],pz=tn[0]*ot[1]-tn[1]*ot[0];
      const pj=(jH(ring*10000+i*7+2)-.5)*spread*.4;
      pw=[pw[0]+px*pj,pw[1]+py*pj,pw[2]+pz*pj];
      seeds.push({pos:pw,tan:tn,out:ot,
        seed:theta*.1+i*.01+(sign[0]+sign[1]+sign[2])*.001});}}
  return seeds;}
// Integrate every seed into a polyline. At each node the flow field pushes
// the velocity, the ring normal component is removed (the filament hugs the
// ring), a pull toward the ring acts by distance, and a curl swirl is added.
// flags: {fObj, sWave} (the baked toggles of the page).
export function traceAll(seeds,C,R,Rt,time,flags){
  const nodes=Math.round(C.sNd),sub=Math.round(C.sSub),maxFils=2000;
  // The step scales with the ring radius, but never past the page default
  // ring (tM 10). The gain scales with the step, so a big ring with a long
  // step overshoots the pull and zigzags.
  const step=C.sSl*Math.min(C.tM,10)*.03/sub;
  const gain=C.fGa*C.fCu*step;
  const oa=flags.fObj,wave=flags.sWave,cf=C.sCf,pr=C.sPr,dt=C.sDt,curS=C.sCur;
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
        const F=field3D(fp,sd.seed,time,C,wave);
        const fW=oa?mV3(Rt,F):F;
        // Remove the component along the ring normal so flow runs tangentially.
        if(pr>.01){const nd=grad[0]*fW[0]+grad[1]*fW[1]+grad[2]*fW[2];
          fW[0]-=nd*grad[0]*pr;fW[1]-=nd*grad[1]*pr;fW[2]-=nd*grad[2]*pr;}
        // Pull toward the ring (distance-proportional, along -normal).
        const cd=Math.max(-5,Math.min(5,dist));
        if(cfj>.01){fW[0]-=cfj*cd*grad[0];fW[1]-=cfj*cd*grad[1];fW[2]-=cfj*cd*grad[2];}
        // Curl swirl about the axis toward the scene centre.
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

// ═══════════════ CHECKS ═══════════════
// ringCheck: the rings cross the body. At each of nT times in [t0, t1], for
// each ring, sample the ring centre line and take bodyDist at each point.
// The ring crosses the body if it goes at least tau = RING_DEPTH x sR inside
// (min bodyDist <= -tau) and at least tau outside (max bodyDist >= tau). A
// ring that floats free of the body, or is buried in it, or only touches its
// surface, fails. worst is the smallest of the two depths over all rings and
// times. extra raises the need to tau + extra (the guard margin).
export const RING_DEPTH=.05;
export function ringCheck(C,t0,t1,nT=12,extra=0){let worst=1e9;const N=48;
  const signs=ringSigns(Math.round(C.sRings));
  for(let k=0;k<nT;k++){const t=t0+(t1-t0)*k/Math.max(1,nT-1);const{R,Rt}=computeGRot(t,C);
    for(const s of signs){let mn=1e9,mx=-1e9;
      for(let i=0;i<N;i++){const d=bodyDist(mV3(R,torusToWorld(i/N*TAU,s,Rt,C,t)),C);
        if(d<mn)mn=d;if(d>mx)mx=d;}
      worst=Math.min(worst,-mn,mx);}}
  const tau=RING_DEPTH*C.sR;
  return{ok:worst>=tau+extra,worst,tau};}
// ringSamples: the sample count and the guard margin for a window of length
// span. The spin is rX(a t) rZ(b t) rY(c t) with t = time x rS, so its
// angular speed is at most w = rS (|a| + |b| + |c|). In the body frame a ring
// point is Rt (s (off + Rt q)), so it moves at most w (r + tM), with r the
// scene radius. bodyDist changes no faster than the point moves. With nT
// samples the most it can change between two samples is delta. A ring that
// passes tau + delta at every sample passes tau at every time between. nT
// keeps delta near tau / 4 x k.
export function ringSamples(C,span,k=1){
  const w=C.rS*(Math.abs(C.moRA)+Math.abs(C.moRB)+Math.abs(C.moRC));
  const v=w*(sceneRadius(C)+C.tM),tau=RING_DEPTH*C.sR;
  const nT=Math.min(4000,Math.max(8,Math.ceil(v*span/(.25*tau*k))+1));
  return{nT,delta:v*span/(nT-1)};}
// flowCheck: the filaments follow the rings. Trace every 5th seed at time t.
// near is the part of all filament nodes within a band of the ring tube
// (|torDist| < max(2, tM/4)). turn is the mean angle in degrees between two
// segments of a filament. The page default gives near 0.95, turn 6.3.
export const FLOW_NEAR_MIN=.8,FLOW_TURN_MAX=8.5;
// m tightens both limits by that share (the saver guard uses a margin).
export function flowCheck(C,t,flags={fObj:true,sWave:true},m=0){
  const{R,Rt}=computeGRot(t,C);const seeds=genSeeds(C,R,Rt,t).filter((_,i)=>i%5===0);
  const fils=traceAll(seeds,C,R,Rt,t,flags),n=Math.round(C.sNd),band=Math.max(2,.25*C.tM);
  let near=0,tot=0,ang=0,cnt=0;
  for(const f of fils){
    for(let j=0;j<n;j++){tot++;if(Math.abs(torDist([f[j*3],f[j*3+1],f[j*3+2]],R,C,t))<band)near++;}
    for(let j=1;j<n-1;j++){
      const ux=f[j*3]-f[j*3-3],uy=f[j*3+1]-f[j*3-2],uz=f[j*3+2]-f[j*3-1];
      const vx=f[j*3+3]-f[j*3],vy=f[j*3+4]-f[j*3+1],vz=f[j*3+5]-f[j*3+2];
      const c=(ux*vx+uy*vy+uz*vz)/(Math.hypot(ux,uy,uz)*Math.hypot(vx,vy,vz)+1e-12);
      ang+=Math.acos(Math.max(-1,Math.min(1,c)));cnt++;}}
  near/=tot||1;const turn=cnt?ang/cnt*180/PI:0;
  return{ok:near>=FLOW_NEAR_MIN*(1+m)&&turn<=FLOW_TURN_MAX*(1-m),near,turn};}

// ═══════════════ SAVER SCENES ═══════════════
// BODY_RANGES: the ring layout ranges per body (BODIES order) where the rings
// cross the body (ringCheck) in most shot windows. b is tM / rr. c is rr
// over the mid surface radius (rMin + rMax) / 2. A larger b gives each ring a
// wider spread of distances from the centre, so it crosses in more windows;
// bMaxFor caps b. The ranges come from a sweep of 30 seeded shot windows per
// (body, ring count, b, c) cell; the cells in these ranges pass in 50 % to
// 100 % of the windows, and the saver guard draws again for the rest.
export const BODY_RANGES=[
  {b:[.45,.7],c:[.93,1.05]},   // cube
  {b:[.42,.7],c:[.95,1.05]},   // sphere
  {b:[.45,.7],c:[.8,.9]},      // octahedron
  {b:[.45,.7],c:[.95,1.05]},   // cylinder
  {b:[.45,.7],c:[.95,1.05]},   // pillow
];
// The ring counts the saver draws. One centred ring is a great circle at
// the constant distance tM from the centre. As the body spins, that circle
// lies fully in or fully out of the body for long stretches, so it passed
// ringCheck in 0 % to 40 % of the swept windows. The page still offers it.
export const SAVER_RINGS=[2,4,8];
// The largest b that keeps each ring off the fold planes. With k folded axes
// the ring centre is tO from each plane and tO^2 = (rr^2 - tM^2) / k. The
// ring stays off the planes if tM < tO, that is b < 1 / sqrt(k + 1). Past
// that, mirror rings merge and the trace zigzags across the seam. The 0.95
// keeps a margin for the tube and the smooth fold.
export function bMaxFor(n){const m=foldMask(n),k=m[0]+m[1]+m[2];return k?.95/Math.sqrt(k+1):1;}
// [name, values, rk]. A [min, max] pair is a seeded value. A shot sets the
// look and the filament regime, never the ring layout. rk scales the fit
// radius (sceneRadius) for the camera; rk 0: no fit (Macro).
// The regimes keep flowCheck true. Field gain fCu stays near 0.2: the gain
// multiplies the field, the pull and the wave, so at 0.7 the mean turn is
// 16 deg and at 2 it is 25 deg. The tube radius tm stays at its default:
// the seeds start on the ring centre line, so a thick tube starts each
// filament inside the tube and the pull zigzags it out.
export const SAVER_SHOTS=[
  ['Lantern',      {}, 1],
  ['Silhouette',   {mMetal:0,mBase:0,gP:[.3,.5],rCb:1.2}, 1.06],
  ['Fused',        {pK:[14,20],cD:[3,4]}, .9],
  ['Constellation',{pK:.1,tm:[.3,.5]}, 1],
  ['Burst',        {sNd:30,sSl:2,sN:40,gP:.6}, 1.08],
  ['Fur',          {fCu:[.2,.25],sN:110,sNd:14,rCw:4,rHw:10,gP:.5,mMetal:.6}, 1],
  ['Hollow',       {sRings:2,cD:4}, 1],
  ['Macro',        {mBrush:.6}, 0],
];
// Seeded in each shot before the shot values, which win. These ranges keep
// flowCheck true. At the top corner of the old ranges (fFr 0.9, fO2 1.2,
// fO3 1) the mean turn was 10 to 11 deg against 6.3 for the default.
export const SAVER_JITTER=[['fFr',.15,.4],['fFrZ',.15,.4],['fO2',0,.8],['fO3',0,.6]];
// The spin, drawn again on each guard try with the layout: a slow spin keeps
// a crossing layout crossing for the whole shot.
export const SAVER_SPIN=[['rS',.3,.5],['moRA',0,.5],['moRB',0,.5],['moRC',0,.5]];
export const SAVER_TRIES=32;
// The radius that holds the body and the rings: the far body surface or the
// far ring edge.
export function sceneRadius(C){const m=foldMask(Math.round(C.sRings)),k=m[0]+m[1]+m[2];
  return Math.max(bodyRadii(C).max,C.tO*Math.sqrt(k)+C.tM+C.tm);}
// The seeded seed-to-scene map. rnd returns [0,1). D is the page defaults.
// It draws the jitter, the shot values, the ring count, the body and its
// size, then the ring layout and the start time until the scene passes the
// guard: ringCheck over the shot window [simTime, simTime + dur * timeScale]
// at ringSamples times with the margin delta (so the rings cross at every
// time of the shot, not only at the samples), and flowCheck at the start and
// the end of the window with a 4 % margin. A try draws the spin, the layout
// and the start time again. tests.mjs checks each scene at 2x the samples
// with no margin.
// Returns {C, simTime, dur, r, tries, ok, name}.
export function saverScene(rnd,i,calm,D){
  const[name,vals,rk]=SAVER_SHOTS[i];
  const C={...D};
  for(const[k,a,b]of SAVER_JITTER)C[k]=a+(b-a)*rnd();
  for(const[k,v]of Object.entries(vals))C[k]=Array.isArray(v)?v[0]+(v[1]-v[0])*rnd():v;
  const n=vals.sRings??SAVER_RINGS[Math.floor(rnd()*SAVER_RINGS.length)];
  C.sRings=n;C.bShape=Math.floor(rnd()*BODIES.length);
  C.sR=18+4*rnd();
  C.timeScale=1-.5*calm;
  const dur=6+5*rnd()+1.5*calm,span=dur*C.timeScale;
  const g=BODY_RANGES[C.bShape],rd=bodyRadii(C),mid=(rd.min+rd.max)/2,cr=g.c;
  let simTime=0,tries=0,ok=false;
  while(!ok&&tries<SAVER_TRIES){tries++;
    for(const[k,a,b]of SAVER_SPIN)C[k]=a+(b-a)*rnd();
    const bh=Math.min(g.b[1],bMaxFor(n)),c=cr[0]+(cr[1]-cr[0])*rnd(),b=g.b[0]+(bh-g.b[0])*rnd();
    Object.assign(C,ringLayout(n,mid*c,b));
    simTime=300*rnd();
    const rs=ringSamples(C,span);
    ok=ringCheck(C,simTime,simTime+span,rs.nT,rs.delta).ok&&
      flowCheck(C,simTime,undefined,.04).ok&&flowCheck(C,simTime+span,undefined,.04).ok;}
  return{C,simTime,dur,r:rk*sceneRadius(C),tries,ok,name};}

// Seeded generator: the same step as the saver rnd in main.js, for tests.
export function makeRnd(seed){let s=(seed>>>0)||1;
  return()=>{s=Math.imul(s^s>>>15,0x2c1b3c6d)+0x6d2b79f5>>>0;s^=s>>>12;return(s>>>0)/4294967296;};}
