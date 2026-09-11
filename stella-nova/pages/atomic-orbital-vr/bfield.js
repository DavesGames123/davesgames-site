/* ════════════════════════════════════════════════════════════
   B FIELD — synchronous Biot-Savart solver + instanced arrows
   Solves B on a grid from the particle current, packs 7 floats per
   grid point, uploads instanced shaft arrows, and interpolates the
   field trilinearly for the tracers. Field state (bFieldData /
   bFieldDim / bFieldExt / bFieldScheduled) lives on core RT because
   the UI, AR panel, AR session, and tracers all touch it.
   GREP: computeBField | uploadBArrows | sampleBField
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, RT, orbitalGroup } from './core.js';
import { fieldColor } from './physics.js';
import { posArr, storedPos } from './particles.js';

/* ════════════════════════════════════════════════════════════
   B FIELD ARROW SYSTEM
   ════════════════════════════════════════════════════════════ */
// B-field arrows: instanced 3D cylinders + cones (thick lines impossible in WebGL)
// One InstancedMesh per part sized to the largest grid (24³); uploadBArrows()
// positions and colors each instance from the solved field.
const MAX_BARROWS = 24*24*24;
const _bShaftGeo = new THREE.CylinderGeometry(0.008,0.008,1,6,1);
const _bHeadGeo  = new THREE.ConeGeometry(0.022,0.08,6,1);
const _bInstMat  = new THREE.MeshBasicMaterial({transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false});
export const bArrowShaft = new THREE.InstancedMesh(_bShaftGeo,_bInstMat.clone(),MAX_BARROWS);
export const bArrowHead  = new THREE.InstancedMesh(_bHeadGeo, _bInstMat.clone(),MAX_BARROWS);
bArrowShaft.count=0; bArrowHead.count=0;
bArrowShaft.frustumCulled=false; bArrowHead.frustumCulled=false;
bArrowShaft.visible=false; bArrowHead.visible=false;
orbitalGroup.add(bArrowShaft); orbitalGroup.add(bArrowHead);
// Keep bArrowLines as alias for visibility checks (will be null-stubbed)
const bArrowLines={visible:false,get _stub(){return true;}};

// Solved field paces periodic recompute; bFieldData / bFieldDim / bFieldExt live
// on core RT so sampleBField() and the tracers can read the grid.

/* ════════════════════════════════════════════════════════════
   B FIELD — SYNCHRONOUS BIOT-SAVART
   J is purely azimuthal so Jy = 0 always.
   Cross product J×d simplifies to 3 mults instead of 6.
   Source J vectors precomputed once, then reused for every
   grid point — avoids trig inside the inner loop.
   Timing: 5³=125 pts × 300 src ≈ 1 ms. 8³=512 × 400 ≈ 8 ms.
   ════════════════════════════════════════════════════════════ */

// Solve B on a G³ grid from the particle cloud. Subsample up to 400 source
// points, precompute their azimuthal current J once, then sum Biot-Savart at
// every grid point. Normalize direction and magnitude, then upload the arrows.
export function computeBField(){
  if(!storedPos)return;
  RT.bFieldScheduled=false;
  const{m,bGridDim,bGridExtent,scale,bArrowScale,bColGamma}=S;
  const count=RT.liveCount; if(count===0)return;

  const G=Math.min(bGridDim,24);  // cap: 24³=13824 pts
  const ext=bGridExtent*scale;
  const ng=G*G*G;

  // ── Subsample sources (max 400) and precompute J ──
  const maxSrc=400;
  const step=Math.max(1,Math.floor(count/maxSrc));
  const ns=Math.min(maxSrc,Math.floor(count/step));
  const ssx=new Float32Array(ns),ssy=new Float32Array(ns),ssz=new Float32Array(ns);
  const sjx=new Float32Array(ns),sjz=new Float32Array(ns); // Jy=0 always
  for(let si=0;si<ns;si++){
    const i=si*step;
    // posArr holds Three.js-unit (scaled) positions
    ssx[si]=posArr[i*3]; ssy[si]=posArr[i*3+1]; ssz[si]=posArr[i*3+2];
    // probabilityFlow needs atomic-unit coords → divide by scale
    const ax=posArr[i*3]/scale, ay=posArr[i*3+1]/scale, az=posArr[i*3+2]/scale;
    const r=Math.sqrt(ax*ax+ay*ay+az*az); if(r<1e-6)continue;
    const theta=Math.acos(Math.max(-1,Math.min(1,ay/r)));
    const phi=Math.atan2(az,ax);
    const st=Math.max(Math.abs(Math.sin(theta)),1e-4);
    const vm=m/(r*st);
    sjx[si]=-vm*Math.sin(phi);  // Jx
    sjz[si]= vm*Math.cos(phi);  // Jz  (Jy=0)
  }

  // ── Biot-Savart on grid ──
  const out=new Float32Array(ng*7);
  let maxMag=0, gi=0;
  const step2=G>1?2*ext/(G-1):1;
  for(let xi=0;xi<G;xi++){
    const px=G>1?-ext+xi*step2:0;
    for(let yi=0;yi<G;yi++){
      const py=G>1?-ext+yi*step2:0;
      for(let zi=0;zi<G;zi++){
        const pz=G>1?-ext+zi*step2:0;
        let Bx=0,By=0,Bz=0;
        for(let si=0;si<ns;si++){
          const dx=px-ssx[si],dy=py-ssy[si],dz=pz-ssz[si];
          const d2=dx*dx+dy*dy+dz*dz;
          if(d2<0.001)continue;
          const inv3=1/(d2*Math.sqrt(d2));
          // B += (J×d)/|d|³  with Jy=0:
          // Bx = Jy·dz - Jz·dy = -Jz·dy
          // By = Jz·dx - Jx·dz
          // Bz = Jx·dy - Jy·dx =  Jx·dy
          const jx=sjx[si],jz=sjz[si];
          Bx+=(-jz*dy)*inv3;
          By+=(jz*dx-jx*dz)*inv3;
          Bz+=(jx*dy)*inv3;
        }
        const mag=Math.sqrt(Bx*Bx+By*By+Bz*Bz);
        if(mag>maxMag)maxMag=mag;
        out[gi*7]=px;out[gi*7+1]=py;out[gi*7+2]=pz;
        out[gi*7+3]=Bx;out[gi*7+4]=By;out[gi*7+5]=Bz;out[gi*7+6]=mag;
        gi++;
      }
    }
  }

  // ── Normalize ──
  if(maxMag>1e-10){
    for(let i=0;i<ng;i++){
      const mag=out[i*7+6];
      if(mag>1e-12){const inv=1/mag;out[i*7+3]*=inv;out[i*7+4]*=inv;out[i*7+5]*=inv;}
      out[i*7+6]/=maxMag;
    }
  }

  RT.bFieldData=out;
  RT.bFieldDim=G;
  RT.bFieldExt=ext;
  document.getElementById('bstatus').textContent='ready';
  document.getElementById('bstatus').className='status-txt ready';
  uploadBArrows();
}

// Reusable temporaries for uploadBArrows — allocated once to avoid per-frame GC.
const _bDummy=new THREE.Object3D();
const _bUp=new THREE.Vector3(0,1,0);
const _bDir=new THREE.Vector3();
const _bQ=new THREE.Quaternion();
const _bAxisX=new THREE.Vector3(1,0,0);
const _bCol=new THREE.Color();

// Push the solved field into the instanced shafts: length scales with magnitude,
// color from fieldColor, orientation from a quaternion that maps +Y to the field
// direction. Arrowheads stay disabled; shafts alone carry the read.
export function uploadBArrows(){
  if(!RT.bFieldData||!S.showBField){
    bArrowShaft.visible=false; return;
  }
  const{bArrowScale,bColGamma}=S;
  const ng=Math.min(RT.bFieldData.length/7|0, MAX_BARROWS);
  const HEAD_LEN=0.08;
  for(let i=0;i<ng;i++){
    const ox=RT.bFieldData[i*7],oy=RT.bFieldData[i*7+1],oz=RT.bFieldData[i*7+2];
    const dx=RT.bFieldData[i*7+3],dy=RT.bFieldData[i*7+4],dz=RT.bFieldData[i*7+5];
    const mag=RT.bFieldData[i*7+6];
    const lv=Math.log10(1+mag*99)/2;
    const len=bArrowScale*(0.06+lv*0.9);
    const [r,g,b]=fieldColor(mag,bColGamma);
    _bDir.set(dx,dy,dz).normalize();
    // Safe quaternion: handle antiparallel-to-up edge case
    if(_bDir.dot(_bUp)<-0.999) _bQ.setFromAxisAngle(_bAxisX,Math.PI);
    else _bQ.setFromUnitVectors(_bUp,_bDir);
    // Shaft: Y-cylinder centered at mid-point of shaft portion
    const shaftLen=Math.max(0.001,len-HEAD_LEN);
    _bDummy.position.set(ox+dx*shaftLen*0.5, oy+dy*shaftLen*0.5, oz+dz*shaftLen*0.5);
    _bDummy.quaternion.copy(_bQ);
    _bDummy.scale.set(1,shaftLen,1);
    _bDummy.updateMatrix();
    bArrowShaft.setMatrixAt(i,_bDummy.matrix);
    _bCol.setRGB(r*0.35,g*0.35,b*0.35); bArrowShaft.setColorAt(i,_bCol);
  }
  bArrowShaft.count=ng;
  bArrowShaft.instanceMatrix.needsUpdate=true;
  if(bArrowShaft.instanceColor) bArrowShaft.instanceColor.needsUpdate=true;
  bArrowShaft.visible=true;
  bArrowHead.visible=false; // arrowheads disabled
}

// Trilinear interpolation of precomputed B field.
// Convert a world point into grid coordinates, clamp to the last full cell, then
// blend the eight corner samples by fractional weights; return unit dir + mag.
export function sampleBField(px,py,pz){
  if(!RT.bFieldData||RT.bFieldDim<2)return[0,1,0,0];
  const G=RT.bFieldDim,ext=RT.bFieldExt,step=2*ext/(G-1);
  const gx=(px+ext)/step,gy=(py+ext)/step,gz=(pz+ext)/step;
  const x0=Math.max(0,Math.min(G-2,Math.floor(gx)));
  const y0=Math.max(0,Math.min(G-2,Math.floor(gy)));
  const z0=Math.max(0,Math.min(G-2,Math.floor(gz)));
  const tx=Math.max(0,Math.min(1,gx-x0)),ty=Math.max(0,Math.min(1,gy-y0)),tz=Math.max(0,Math.min(1,gz-z0));
  function cell(xi,yi,zi){const i=(xi*G*G+yi*G+zi)*7;return RT.bFieldData.subarray(i,i+7);}
  const w=[(1-tx)*(1-ty)*(1-tz),tx*(1-ty)*(1-tz),(1-tx)*ty*(1-tz),tx*ty*(1-tz),(1-tx)*(1-ty)*tz,tx*(1-ty)*tz,(1-tx)*ty*tz,tx*ty*tz];
  const corners=[[x0,y0,z0],[x0+1,y0,z0],[x0,y0+1,z0],[x0+1,y0+1,z0],[x0,y0,z0+1],[x0+1,y0,z0+1],[x0,y0+1,z0+1],[x0+1,y0+1,z0+1]];
  let dx=0,dy=0,dz=0,mag=0;
  for(let c=0;c<8;c++){const cl=cell(corners[c][0],corners[c][1],corners[c][2]);dx+=w[c]*cl[3];dy+=w[c]*cl[4];dz+=w[c]*cl[5];mag+=w[c]*cl[6];}
  const len=Math.sqrt(dx*dx+dy*dy+dz*dz);
  if(len>1e-6){dx/=len;dy/=len;dz/=len;}
  return[dx,dy,dz,mag];
}
