/* ════════════════════════════════════════════════════════════
   TRACERS — probability-flow streaks + advected B field lines
   Two pre-allocated line-buffer systems. Flow tracers rotate in φ
   along the azimuthal current and reseed from the cloud; B tracers
   walk the interpolated field. The live lists live on core RT
   (flowTracers / bTracers) because the streamer and the UI clear them.
   GREP: updateFlowTracers | updateBTracers | ftLines | btLines
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, RT, orbitalGroup } from './core.js';
import { fieldColor } from './physics.js';
import { storedSph } from './particles.js';
import { sampleBField } from './bfield.js';

/* ════════════════════════════════════════════════════════════
   FLOW TRACERS  (follow probability current J, azimuthal rotation)
   ════════════════════════════════════════════════════════════ */
// Pre-allocated line buffers for the flow tracers: MAX_FT tracers, each a trail
// of up to MAX_FT_TRAIL segments (2 verts per segment, 3 floats per vert).
const MAX_FT=2000, MAX_FT_TRAIL=80;
const ftPosArr=new Float32Array(MAX_FT*MAX_FT_TRAIL*2*3);
const ftColArr=new Float32Array(MAX_FT*MAX_FT_TRAIL*2*3);
const ftLineGeo=new THREE.BufferGeometry();
ftLineGeo.setAttribute('position',new THREE.BufferAttribute(ftPosArr,3));
ftLineGeo.setAttribute('color',new THREE.BufferAttribute(ftColArr,3));
const ftLineMat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.8});
export const ftLines=new THREE.LineSegments(ftLineGeo,ftLineMat);
orbitalGroup.add(ftLines);ftLines.visible=false;

// Advance the probability-flow tracers: age and rotate each in φ along the
// azimuthal current, prepend to its trail, respawn from the cloud to keep the
// target count, then pack all trails into the line buffer with a fade by age.
export function updateFlowTracers(dt){
  if(!S.showFlowTr||S.m===0){ftLines.visible=false;return;}
  ftLines.visible=true;
  const flowTracers=RT.flowTracers;
  const{m,scale,flowSpeed,flowTrCount,flowTrTrail}=S;
  const fdt=dt*flowSpeed*2;
  const ext=RT.bFieldExt>0?RT.bFieldExt:5;

  // Move + age
  for(let i=flowTracers.length-1;i>=0;i--){
    const tr=flowTracers[i];
    tr.age+=dt;
    // Rotate in phi (azimuthal probability current)
    const r=tr.r,theta=tr.theta;
    const st=Math.max(Math.abs(Math.sin(theta)),1e-4);
    tr.phi+=m/(r*st)*fdt;
    const sinT=Math.sin(theta);
    const sx=r*sinT*Math.cos(tr.phi)*scale;
    const sy=r*Math.cos(theta)*scale; // y unchanged
    const sz=r*sinT*Math.sin(tr.phi)*scale;
    tr.trail.unshift([sx,sy,sz]);
    if(tr.trail.length>flowTrTrail)tr.trail.pop();
    if(tr.age>=tr.maxAge)flowTracers.splice(i,1);
  }

  // Spawn from particle cloud
  while(flowTracers.length<flowTrCount){
    if(RT.liveCount===0)break;
    const idx=Math.floor(Math.random()*RT.liveCount);
    const r=storedSph[idx*3],theta=storedSph[idx*3+1],phi=storedSph[idx*3+2];
    if(r<0.5)continue;
    flowTracers.push({r,theta,phi,trail:[],age:0,maxAge:2.5+Math.random()*2});
  }

  // Build line buffer
  const posA=ftLineGeo.attributes.position.array;
  const colA=ftLineGeo.attributes.color.array;
  let vi=0;
  for(const tr of flowTracers){
    const tl=tr.trail.length;if(tl<2)continue;
    const ageA=tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.8?(tr.maxAge-tr.age)/(tr.maxAge*0.2):1;
    for(let s=0;s<tl-1;s++){
      const a0=(1-s/flowTrTrail)*ageA, a1=(1-(s+1)/flowTrTrail)*ageA*.3;
      const pt=tr.trail[s],pn=tr.trail[s+1];
      posA[vi*3]=pt[0];posA[vi*3+1]=pt[1];posA[vi*3+2]=pt[2];
      colA[vi*3]=0.2*a0;colA[vi*3+1]=0.7*a0;colA[vi*3+2]=1.0*a0; vi++;
      posA[vi*3]=pn[0];posA[vi*3+1]=pn[1];posA[vi*3+2]=pn[2];
      colA[vi*3]=0.05*a1;colA[vi*3+1]=0.3*a1;colA[vi*3+2]=0.7*a1; vi++;
    }
  }
  ftLineGeo.attributes.position.needsUpdate=true;
  ftLineGeo.attributes.color.needsUpdate=true;
  ftLineGeo.setDrawRange(0,vi);
}

/* ════════════════════════════════════════════════════════════
   B-FIELD TRACERS  (advect along interpolated B field)
   ════════════════════════════════════════════════════════════ */
// Same buffer scheme for the B-field tracers, sized for many short field lines.
const MAX_BT=50000, MAX_BT_TRAIL=40;
const btPosArr=new Float32Array(MAX_BT*MAX_BT_TRAIL*2*3);
const btColArr=new Float32Array(MAX_BT*MAX_BT_TRAIL*2*3);
const btLineGeo=new THREE.BufferGeometry();
btLineGeo.setAttribute('position',new THREE.BufferAttribute(btPosArr,3));
btLineGeo.setAttribute('color',new THREE.BufferAttribute(btColArr,3));
const btLineMat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.9});
export const btLines=new THREE.LineSegments(btLineGeo,btLineMat);
orbitalGroup.add(btLines);btLines.visible=false;

// Advect the B-field tracers: step each along the sampled field, trail it, and
// retire it when old or out of bounds. Spawn uses a fractional accumulator so the
// spawn rate stays exact regardless of frame rate. Color follows field magnitude.
export function updateBTracers(dt){
  if(!S.showBTr||!RT.bFieldData){btLines.visible=false;return;}
  btLines.visible=true;
  const bTracers=RT.bTracers;
  const{bTrSpeed,bTrSpawn,bTrTrail,bColGamma}=S;
  const ext=RT.bFieldExt;

  for(let i=bTracers.length-1;i>=0;i--){
    const tr=bTracers[i];tr.age+=dt;
    const[dx,dy,dz,mag]=sampleBField(tr.x,tr.y,tr.z);
    tr.x+=dx*bTrSpeed*dt;tr.y+=dy*bTrSpeed*dt;tr.z+=dz*bTrSpeed*dt;
    tr.trail.unshift([tr.x,tr.y,tr.z,mag]);
    if(tr.trail.length>bTrTrail)tr.trail.pop();
    if(tr.age>=tr.maxAge||Math.abs(tr.x)>ext||Math.abs(tr.y)>ext||Math.abs(tr.z)>ext)bTracers.splice(i,1);
  }
  // Spawn: fractional accumulator so rate is exact regardless of framerate
  const spawnF = bTrSpawn * dt;
  const spawnN = Math.floor(spawnF) + (Math.random() < (spawnF % 1) ? 1 : 0);
  for(let s=0; s<spawnN && bTracers.length<MAX_BT; s++){
    const e=ext*.9;
    bTracers.push({x:(Math.random()*2-1)*e,y:(Math.random()*2-1)*e,z:(Math.random()*2-1)*e,trail:[],age:0,maxAge:2+Math.random()*2});
  }

  const posA=btLineGeo.attributes.position.array;
  const colA=btLineGeo.attributes.color.array;
  let vi=0;
  for(const tr of bTracers){
    const tl=tr.trail.length;if(tl<2)continue;
    const ageA=tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.8?(tr.maxAge-tr.age)/(tr.maxAge*0.2):1;
    for(let s=0;s<tl-1;s++){
      const pt=tr.trail[s],pn=tr.trail[s+1];
      const a0=(1-s/bTrTrail)*ageA,a1=(1-(s+1)/bTrTrail)*ageA*.25;
      const[r0,g0,b0]=fieldColor(pt[3]||0,bColGamma);
      const[r1,g1,b1]=fieldColor(pn[3]||0,bColGamma);
      posA[vi*3]=pt[0];posA[vi*3+1]=pt[1];posA[vi*3+2]=pt[2];
      colA[vi*3]=r0*a0;colA[vi*3+1]=g0*a0;colA[vi*3+2]=b0*a0;vi++;
      posA[vi*3]=pn[0];posA[vi*3+1]=pn[1];posA[vi*3+2]=pn[2];
      colA[vi*3]=r1*a1;colA[vi*3+1]=g1*a1;colA[vi*3+2]=b1*a1;vi++;
    }
  }
  btLineGeo.attributes.position.needsUpdate=true;
  btLineGeo.attributes.color.needsUpdate=true;
  btLineGeo.setDrawRange(0,vi);
}
