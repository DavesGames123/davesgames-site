/* ════════════════════════════════════════════════════════════
   PARTICLES — the pre-allocated cloud + chunked streamer
   Pre-allocated position / color / spherical buffers, the pSystem
   points, the static-flow arrows, the axes helper, and the
   spawn / grow / recolor / flow-animation functions.
   CDF sampling tables are co-located here (option a) because only
   this subsystem rebuilds them; liveCount / targetCount / spawning /
   colorRollIdx / flowTracers / bTracers are on core RT (option b).
   GREP: makeCircleTex | startRebuild | startGrow | rebuildParticles
         spawnChunk | updateColors | animateFlow | rebuildStaticFlow
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, RT, orbitalGroup } from './core.js';
import { particleColor, probabilityFlow } from './physics.js';
import { buildRadialCDF, buildThetaCDF, sampleCDF } from './cdf.js';
import { updateInfoBar } from './ui.js';
import { computeBField } from './bfield.js';

/* ════════════════════════════════════════════════════════════
   PRE-ALLOCATED PARTICLE BUFFERS (2 M cap)
   posArr  — Three.js-unit positions  (x·scale, y·scale, z·scale)
   sphArr  — spherical coords in a.u. (r, θ, φ) — used by flow anim & color update
   colArr  — RGB colors
   Never reallocated; only liveCount and pGeo.drawRange change.
   ════════════════════════════════════════════════════════════ */
const MAX_P = 2_000_000;
export const posArr = new Float32Array(MAX_P * 3);
export const colArr = new Float32Array(MAX_P * 3);
export const sphArr = new Float32Array(MAX_P * 3);

// Aliases kept for functions that used old names
export const storedPos = posArr;   // NOTE: now holds scaled positions, not atomic
export const storedSph = sphArr;

// CDF state — rebuilt when (n,l) or (l,m) change
let rCDF = null, tCDF = null;
let cdfN = -1, cdfL = -1, cdfM = -999;

const SPAWN_CHUNK = 15_000;
const COLOR_CHUNK =  80_000;

// Loading overlay reference used by the streamer.
const loadingEl=document.getElementById('loading');

// Circle sprite texture (avoids square particles)
// A soft radial-alpha disc used as the point sprite so particles read as dots.
function makeCircleTex(){
  const c=document.createElement('canvas');c.width=64;c.height=64;
  const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.55,'rgba(255,255,255,0.9)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}

// Main particle cloud — attributes point permanently into pre-allocated arrays.
// DynamicDrawUsage marks them for frequent re-upload; only drawRange and the
// dirty flags change, never the buffers themselves. Frustum culling is off and
// the bounding sphere is infinite so points never vanish at any camera pose.
const pGeo=new THREE.BufferGeometry();
const pPosAttr=new THREE.BufferAttribute(posArr,3); pPosAttr.setUsage(THREE.DynamicDrawUsage);
const pColAttr=new THREE.BufferAttribute(colArr,3); pColAttr.setUsage(THREE.DynamicDrawUsage);
pGeo.setAttribute('position',pPosAttr);
pGeo.setAttribute('color',pColAttr);
pGeo.setDrawRange(0,0);
export const pMat=new THREE.PointsMaterial({size:S.psize,vertexColors:true,transparent:true,opacity:1.0,sizeAttenuation:true,depthWrite:true,blending:THREE.NormalBlending,map:makeCircleTex(),alphaTest:0.5});
export const pSystem=new THREE.Points(pGeo,pMat);
pSystem.frustumCulled=false; // never cull — particles must render at all camera distances/angles
pGeo.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,0,0),Infinity); // explicit infinite sphere
orbitalGroup.add(pSystem);

// Static flow arrows: a fixed sample of probability-current vectors, off by
// default and rebuilt by rebuildStaticFlow() when the Extras toggle turns on.
const flowGeo=new THREE.BufferGeometry();
const flowMat=new THREE.LineBasicMaterial({color:0x5a8cc0,transparent:true,opacity:.35});
const flowLines=new THREE.LineSegments(flowGeo,flowMat);
orbitalGroup.add(flowLines);flowLines.visible=false;

// Axes
export const axesHelper=new THREE.AxesHelper(4);axesHelper.visible=false;orbitalGroup.add(axesHelper);

/* ════════════════════════════════════════════════════════════
   PARTICLE GENERATION — chunked streamer
   startRebuild(): clears cloud, begins filling toward targetCount
   startGrow():    keeps existing particles, adds up to targetCount
   spawnChunk():   called every frame, adds SPAWN_CHUNK particles
   ════════════════════════════════════════════════════════════ */
// Clear the cloud and start filling from zero. Rebuilds the CDF tables only when
// (n,ℓ) or (ℓ,m) actually changed, then aims spawning at the target count.
export function startRebuild(){
  RT.liveCount=0; pGeo.setDrawRange(0,0); RT.colorRollIdx=0;
  RT.flowTracers=[]; RT.bTracers=[];
  const{n,l,m}=S;
  if(n!==cdfN||l!==cdfL) rCDF=buildRadialCDF(n,l);
  if(l!==cdfL||m!==cdfM) tCDF=buildThetaCDF(l,m);
  cdfN=n; cdfL=l; cdfM=m;
  RT.targetCount=Math.min(S.N, MAX_P);
  RT.spawning=true;
  loadingEl.classList.add('show');
}

// Change the count without rebuilding: keep existing particles and either grow
// toward the new target or, if smaller, just shrink the draw range.
export function startGrow(){
  RT.targetCount=Math.min(S.N, MAX_P);
  if(RT.targetCount<=RT.liveCount){ // shrink
    RT.liveCount=RT.targetCount; pGeo.setDrawRange(0,RT.liveCount);
    pPosAttr.needsUpdate=true; pColAttr.needsUpdate=true;
    updateInfoBar(RT.liveCount); return;
  }
  RT.spawning=true;
  loadingEl.classList.add('show');
}

// Legacy alias used by the dirty-flag path
function rebuildParticles(){ startRebuild(); }

// Add one SPAWN_CHUNK of particles per frame while spawning. Each accepted point
// is sampled from the CDF tables, rejected if it falls outside the active cross
// section, then written into all three buffers. Finishing kicks off flow and B.
export function spawnChunk(){
  if(!RT.spawning) return;
  if(RT.liveCount>=RT.targetCount){
    RT.spawning=false;
    loadingEl.classList.remove('show');
    updateInfoBar(RT.liveCount);
    if(S.showFlow) rebuildStaticFlow();
    if(S.showBField&&!RT.bFieldScheduled){RT.bFieldScheduled=true;setTimeout(computeBField,100);}
    return;
  }

  const{n,l,m,scale,viewMode,cutAxis,cutPos,simTime,colorMode,scaler}=S;
  const toAdd=Math.min(SPAWN_CHUNK, RT.targetCount-RT.liveCount);
  let added=0, attempts=0;

  while(added<toAdd && attempts<toAdd*8 && RT.liveCount+added<MAX_P){
    attempts++;
    const r=sampleCDF(rCDF,rCDF.rMax), th=sampleCDF(tCDF,Math.PI), ph=Math.random()*6.2831853;
    if(r<1e-6) continue;
    const sinT=Math.sin(th);
    const x=r*sinT*Math.cos(ph), y=r*Math.cos(th), z=r*sinT*Math.sin(ph);
    const cv=cutAxis===0?x:cutAxis===1?y:z;
    if(viewMode===1&&cv>cutPos) continue;
    if(viewMode===2&&cv<cutPos) continue;

    const i=RT.liveCount+added;
    sphArr[i*3]=r; sphArr[i*3+1]=th; sphArr[i*3+2]=ph;
    posArr[i*3]=x*scale; posArr[i*3+1]=y*scale; posArr[i*3+2]=z*scale;
    const c=particleColor(x,y,z,n,l,m,simTime,colorMode,scaler);
    colArr[i*3]=c[0]; colArr[i*3+1]=c[1]; colArr[i*3+2]=c[2];
    added++;
  }

  RT.liveCount+=added;
  pPosAttr.needsUpdate=true;
  pColAttr.needsUpdate=true;
  pGeo.setDrawRange(0,RT.liveCount);
  updateInfoBar(RT.liveCount);
}

/* ════════════════════════════════════════════════════════════
   COLOR UPDATE — rolling window
   Processes COLOR_CHUNK particles per frame so even 2 M particles
   stay smooth. Full pass completes in ceil(liveCount/COLOR_CHUNK) frames.
   For mode 0 with pure flow animation, colors never need updating
   (|ψ|² is constant along φ-orbits).
   ════════════════════════════════════════════════════════════ */
export function updateColors(){
  if(RT.liveCount===0) return;
  const{n,l,m,simTime,colorMode,scaler}=S;
  const count=RT.liveCount;
  // Roll through COLOR_CHUNK particles per call
  const end=Math.min(RT.colorRollIdx+COLOR_CHUNK, count);
  for(let i=RT.colorRollIdx;i<end;i++){
    const r=sphArr[i*3],th=sphArr[i*3+1],ph=sphArr[i*3+2];
    const sinT=Math.sin(th);
    const x=r*sinT*Math.cos(ph), y=r*Math.cos(th), z=r*sinT*Math.sin(ph);
    const c=particleColor(x,y,z,n,l,m,simTime,colorMode,scaler);
    colArr[i*3]=c[0]; colArr[i*3+1]=c[1]; colArr[i*3+2]=c[2];
  }
  RT.colorRollIdx = end>=count ? 0 : end;
  pColAttr.needsUpdate=true;
}

/* ════════════════════════════════════════════════════════════
   PROBABILITY FLOW ANIMATION
   sphArr[i] = (r, θ, φ) in atomic units.
   Each frame: advance φ by m/(r·sinθ)·dt, recompute x,z into posArr.
   No acos/atan2 — only cos/sin → fast even at 2 M particles.
   ════════════════════════════════════════════════════════════ */
export function animateFlow(dt){
  if(RT.liveCount===0) return;
  const{m,scale,flowSpeed}=S;
  if(m===0) return;
  const fdt=dt*flowSpeed;
  for(let i=0;i<RT.liveCount;i++){
    const r=sphArr[i*3], theta=sphArr[i*3+1];
    const st=Math.max(Math.abs(Math.sin(theta)),1e-4);
    sphArr[i*3+2]+=m/(r*st)*fdt;        // advance φ
    const ph=sphArr[i*3+2];
    const sinT=Math.sin(theta);
    posArr[i*3  ]=r*sinT*Math.cos(ph)*scale;
    posArr[i*3+2]=r*sinT*Math.sin(ph)*scale; // posArr[i*3+1] (y) unchanged
  }
  pPosAttr.needsUpdate=true;
}

/* ── Static flow arrows ── */
// Rebuild the fixed set of current arrows: draw random points in the shell, take
// the probability-current direction there, and emit a short line segment each.
export function rebuildStaticFlow(){
  const geo=flowGeo;while(geo.attributes.position)geo.deleteAttribute('position');
  if(!S.showFlow){flowLines.visible=false;return;}
  flowLines.visible=true;
  const{m,n,scale}=S,rMax=7*n*n;
  const pts=[];
  for(let i=0;i<350;i++){
    let rx,ry,rz,r;
    do{rx=(Math.random()*2-1)*rMax;ry=(Math.random()*2-1)*rMax;rz=(Math.random()*2-1)*rMax;r=Math.sqrt(rx*rx+ry*ry+rz*rz);}while(r<3||r>rMax*.75);
    const J=probabilityFlow(rx,ry,rz,m);
    const fl=Math.sqrt(J[0]*J[0]+J[1]*J[1]+J[2]*J[2]);if(fl<1e-8)continue;
    const len=2;
    pts.push(rx*scale,ry*scale,rz*scale);
    pts.push((rx+J[0]/fl*len)*scale,(ry+J[1]/fl*len)*scale,(rz+J[2]/fl*len)*scale);
  }
  const pa=new Float32Array(pts);
  geo.setAttribute('position',new THREE.BufferAttribute(pa,3));
  geo.setDrawRange(0,pts.length/3);
}
