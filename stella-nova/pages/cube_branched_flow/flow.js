// ============================================================================
//  flow.js  ·  DOM-free scene geometry for the cube SDF + branched flow page
// ----------------------------------------------------------------------------
//  This module holds the CPU half of the scene. main.js imports it for the
//  filament trace. It has no DOM, no WebGL and no global state.
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
//  SECTION MAP   (grep -n "<anchor>" flow.js)
//      math ................. "MATH"
//      body shapes .......... "BODIES"          shape list + bodyDist + bodyRadii
//      rings ................ "RINGS"           foldMask, ringSigns, ringLayout
//      ring sdf ............. "TORUS SDF"       torDist, torGrad
//      flow field ........... "function field3D"
//      seeds + trace ........ "function genSeeds", "function traceAll"
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
