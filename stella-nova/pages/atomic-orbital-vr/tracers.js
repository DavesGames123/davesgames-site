/* ════════════════════════════════════════════════════════════
   TRACERS — probability-flow streaks + advected B field lines
   Two pre-allocated line-buffer systems. Flow tracers rotate in φ
   along the azimuthal current and reseed from the cloud; B tracers
   walk the interpolated field. The live lists live on core RT
   (flowTracers / bTracers) because the streamer and the UI clear them.
   Each list has a hard cap. At the B cap, a new tracer recycles the
   oldest one. Only the used part of each buffer goes to the GPU.
   Each trail fades as one smooth ramp from head to tail.
   GREP: updateFlowTracers | updateBTracers | ftLines | btLines
         MAX_BT_LIVE | MAX_BT_SEG | trailFade | uploadUsed
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, RT, orbitalGroup } from './core.js';
import { fieldColor } from './physics.js';
import { storedSph } from './particles.js';
import { sampleBField } from './bfield.js';

// Brightness at trail position u (0 = head, 1 = tail). One continuous
// curve for all vertices, so adjacent segments meet at the same value.
function trailFade(u){return 1-u;}

// Fade in over the first 0.1 s and fade out over the last 20 % of life.
function ageFade(tr){return tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.8?Math.max(0,(tr.maxAge-tr.age)/(tr.maxAge*0.2)):1;}

// Send only the first `verts` vertices of each attribute to the GPU.
// Without an update range, three.js uploads the full array each frame.
function uploadUsed(geo,verts){
  for(const name of ['position','color']){
    const a=geo.attributes[name];
    a.clearUpdateRanges(); a.addUpdateRange(0,Math.max(1,verts)*3);
    a.needsUpdate=true;
  }
  geo.setDrawRange(0,verts);
}

/* ════════════════════════════════════════════════════════════
   FLOW TRACERS  (follow probability current J, azimuthal rotation)
   ════════════════════════════════════════════════════════════ */
// Pre-allocated line buffers for the flow tracers: MAX_FT tracers, each a trail
// of up to MAX_FT_TRAIL segments (2 verts per segment, 3 floats per vert).
const MAX_FT=2000, MAX_FT_TRAIL=80;
const ftPosArr=new Float32Array(MAX_FT*MAX_FT_TRAIL*2*3);
const ftColArr=new Float32Array(MAX_FT*MAX_FT_TRAIL*2*3);
const ftLineGeo=new THREE.BufferGeometry();
ftLineGeo.setAttribute('position',new THREE.BufferAttribute(ftPosArr,3).setUsage(THREE.DynamicDrawUsage));
ftLineGeo.setAttribute('color',new THREE.BufferAttribute(ftColArr,3).setUsage(THREE.DynamicDrawUsage));
const MAX_FT_VERTS=MAX_FT*MAX_FT_TRAIL*2;
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

  // Spawn from particle cloud. The try limit stops an endless loop
  // when too few particles lie outside r = 0.5.
  const want=Math.min(flowTrCount,MAX_FT);
  let tries=0;
  while(flowTracers.length<want && tries++<want*8){
    if(RT.liveCount===0)break;
    const idx=Math.floor(Math.random()*RT.liveCount);
    const r=storedSph[idx*3],theta=storedSph[idx*3+1],phi=storedSph[idx*3+2];
    if(r<0.5)continue;
    flowTracers.push({r,theta,phi,trail:[],age:0,maxAge:2.5+Math.random()*2});
  }

  // Build line buffer. Color goes from head blue to tail blue along the
  // trail, and brightness follows trailFade, so no segment has a step.
  const posA=ftLineGeo.attributes.position.array;
  const colA=ftLineGeo.attributes.color.array;
  let vi=0;
  for(const tr of flowTracers){
    const tl=Math.min(tr.trail.length,MAX_FT_TRAIL+1);if(tl<2)continue;
    if(vi+(tl-1)*2>MAX_FT_VERTS)break;
    const ageA=ageFade(tr), inv=1/(tl-1);
    for(let s=0;s<tl-1;s++){
      for(let e=0;e<2;e++){
        const u=(s+e)*inv, a=trailFade(u)*ageA, p=tr.trail[s+e];
        posA[vi*3]=p[0];posA[vi*3+1]=p[1];posA[vi*3+2]=p[2];
        colA[vi*3]=(0.2-0.15*u)*a;colA[vi*3+1]=(0.7-0.4*u)*a;colA[vi*3+2]=(1.0-0.3*u)*a; vi++;
      }
    }
  }
  uploadUsed(ftLineGeo,vi);
}

/* ════════════════════════════════════════════════════════════
   B-FIELD TRACERS  (advect along interpolated B field)
   ════════════════════════════════════════════════════════════ */
// Same buffer scheme for the B-field tracers. The live count has a hard cap
// (MAX_BT_LIVE). The buffer holds MAX_BT_SEG segments, which covers the cap
// at the longest trail slider value (120).
const MAX_BT_LIVE=6000, MAX_BT_SEG=MAX_BT_LIVE*120;
const MAX_BT_VERTS=MAX_BT_SEG*2;
const btPosArr=new Float32Array(MAX_BT_VERTS*3);
const btColArr=new Float32Array(MAX_BT_VERTS*3);
const btLineGeo=new THREE.BufferGeometry();
btLineGeo.setAttribute('position',new THREE.BufferAttribute(btPosArr,3).setUsage(THREE.DynamicDrawUsage));
btLineGeo.setAttribute('color',new THREE.BufferAttribute(btColArr,3).setUsage(THREE.DynamicDrawUsage));
const btLineMat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.9});
export const btLines=new THREE.LineSegments(btLineGeo,btLineMat);
orbitalGroup.add(btLines);btLines.visible=false;

// Advect the B-field tracers: step each along the sampled field, trail it, and
// retire it when old or out of bounds. Spawn uses a fractional accumulator so the
// spawn rate stays exact regardless of frame rate. Each trail point keeps the
// field color from when it was made, so fieldColor runs once per point.
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
    const[r,g,b]=fieldColor(mag,bColGamma);
    tr.trail.unshift([tr.x,tr.y,tr.z,r,g,b]);
    while(tr.trail.length>bTrTrail)tr.trail.pop();
    if(tr.age>=tr.maxAge||Math.abs(tr.x)>ext||Math.abs(tr.y)>ext||Math.abs(tr.z)>ext)bTracers.splice(i,1);
  }
  // Spawn: fractional accumulator so rate is exact regardless of framerate.
  // Never spawn more than the cap in one frame. At the cap, recycle the
  // oldest tracer (index 0) instead of adding a new one.
  const spawnF = bTrSpawn * dt;
  const spawnN = Math.min(MAX_BT_LIVE, Math.floor(spawnF) + (Math.random() < (spawnF % 1) ? 1 : 0));
  const e=ext*.9;
  for(let s=0; s<spawnN; s++){
    const tr=bTracers.length>=MAX_BT_LIVE?bTracers.shift():{trail:[]};
    tr.x=(Math.random()*2-1)*e;tr.y=(Math.random()*2-1)*e;tr.z=(Math.random()*2-1)*e;
    tr.trail.length=0;tr.age=0;tr.maxAge=2+Math.random()*2;
    bTracers.push(tr);
  }

  // Pack the trails. Brightness follows trailFade along the whole trail, so
  // the end of one segment and the start of the next have the same value.
  const posA=btLineGeo.attributes.position.array;
  const colA=btLineGeo.attributes.color.array;
  let vi=0;
  for(const tr of bTracers){
    const tl=tr.trail.length;if(tl<2)continue;
    if(vi+(tl-1)*2>MAX_BT_VERTS)break;
    const ageA=ageFade(tr), inv=1/(tl-1);
    for(let s=0;s<tl-1;s++){
      for(let k=0;k<2;k++){
        const p=tr.trail[s+k], a=trailFade((s+k)*inv)*ageA;
        posA[vi*3]=p[0];posA[vi*3+1]=p[1];posA[vi*3+2]=p[2];
        colA[vi*3]=p[3]*a;colA[vi*3+1]=p[4]*a;colA[vi*3+2]=p[5]*a;vi++;
      }
    }
  }
  uploadUsed(btLineGeo,vi);
}
