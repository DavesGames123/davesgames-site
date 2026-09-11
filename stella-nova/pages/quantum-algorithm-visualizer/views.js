// QAVE views: layer-stack build/reveal (buildStackUpTo/updateStack/drawStackNetwork)
// and the floor field (updateFloor), plus their stack helpers (heatCut/layerEnd/
// edgeEnd/selectedOutcomeIndex) and the append-once instance cache.
//   grep -n "function updateStack" views.js   grep -n "function updateFloor" views.js
import * as THREE from 'three';
import { VS, RT, grp, dummy, _col, PITCH, CUBE, MAXH, LAYER_GAP, cellColor, ghostsEnabled, currentStageFor } from './core.js';
import { writeBoxEdges } from './scene.js';
import { densityToCell } from './presets.js';
import { glowGain } from './color.js';


/* ════════ shared helpers ════════ */
// The measured basis-state index for this circuit, or -1 if no measurement fired.
function selectedOutcomeIndex(){if(!RT.trace)return -1;const ms=RT.trace.steps.find(s=>s.selectedOutcome!=null);return ms?(parseInt(ms.selectedOutcome,2)||0):-1;}

/* ════════ STACK view ════════
   Fixed true cubes. Each computation stage drops in its WHOLE layer at once, at its
   final settled color. Color never morphs. Instances for a layer are written ONCE,
   when that layer first appears — so holding/orbiting costs ~nothing even at 8 qubits. */
function heatCut(){return Math.max(1e-4,VS.threshold);}   // |ρ| below this renders as a transparent ghost (edges only); Heat slider raises it
// Cumulative instance counts: how many solid cells / ghost edges exist through
// layer L. These make revealing a layer a matter of setting count and drawRange.
function layerEnd(L){return L<0?0:(RT.layerEndArr[L]||0);}
function edgeEnd(L){return L<0?0:(RT.edgeEndArr[L]||0);}
// Ensure every layer up to `stage` has its instances written, appending only the
// newly revealed layers (append-once). Each cell above the heat cutoff becomes a
// colored cube; zeros become wireframe ghosts (dropped past 4 qubits). The final
// lines just set count/drawRange so only the shown layers render.
function buildStackUpTo(stage){
  stage=Math.min(stage,RT.totalLayers-1);
  const CUT=heatCut(),ghosts=ghostsEnabled();
  if(stage>RT.builtStage){                                   // append newly-revealed layers once; render EVERY cell
    let si=layerEnd(RT.builtStage),ei=edgeEnd(RT.builtStage);
    for(let L=RT.builtStage+1;L<=stage;L++){
      const meas=(L>=1&&RT.trace.steps[L-1]&&RT.trace.steps[L-1].kind==='measurement');
      const sel=meas?selectedOutcomeIndex():-1;
      const cells=RT.layerCell[L],baseY=L*LAYER_GAP;
      for(let r=0;r<RT.DIM;r++)for(let c=0;c<RT.DIM;c++){
        const k=(r*RT.DIM+c)*3;const mag=cells[k];const isSel=(meas&&sel>=0&&r===sel&&c===sel);
        if(mag>=CUT||isSel){                               // solid colored box
          dummy.position.set((c-(RT.DIM-1)/2)*PITCH,baseY,(r-(RT.DIM-1)/2)*PITCH);dummy.scale.set(1,1,1);dummy.updateMatrix();
          let col=cellColor(mag,cells[k+1],cells[k+2]),gv=mag;if(isSel){col=[255,250,235];gv=1;}
          RT.cellMesh.setMatrixAt(si,dummy.matrix);
          _col.setRGB(col[0]/255,col[1]/255,col[2]/255,THREE.SRGBColorSpace).multiplyScalar(glowGain(gv));RT.cellMesh.setColorAt(si,_col);si++;
        }else if(ghosts){                                  // zero probability → clean cube edges (no diagonals); dropped at 7+ qubits
          ei=writeBoxEdges(RT.edgeBuf,ei,(c-(RT.DIM-1)/2)*PITCH,baseY,(r-(RT.DIM-1)/2)*PITCH,CUBE);
        }
      }
      RT.layerEndArr[L]=si;RT.edgeEndArr[L]=ei;
    }
    RT.builtStage=stage;
    RT.cellMesh.instanceMatrix.needsUpdate=true;if(RT.cellMesh.instanceColor)RT.cellMesh.instanceColor.needsUpdate=true;
    RT.edgeLines.geometry.attributes.position.needsUpdate=true;
  }
  const shown=Math.min(stage,RT.builtStage);
  RT.cellMesh.count=shown<0?0:layerEnd(shown);RT.edgeLines.geometry.setDrawRange(0,shown<0?0:edgeEnd(shown));
  return shown;
}
// Draw the "shot-stack network": lines from the source population cells in the
// layer below a measurement up to the single collapsed outcome cell above it.
function drawStackNetwork(stage){
  let measLayer=-1;
  for(let L=1;L<=stage;L++){if(RT.trace.steps[L-1]&&RT.trace.steps[L-1].kind==='measurement'){measLayer=L;break;}}
  if(!VS.network||measLayer<1){RT.netLines.visible=false;return;}
  RT.netLines.visible=true;const pos=RT.netLines.geometry.attributes.position.array,cap=(pos.length/6)|0;let v=0;
  const sel=selectedOutcomeIndex(),src=RT.layerCell[measLayer-1];
  const selX=(sel-(RT.DIM-1)/2)*PITCH,selZ=(sel-(RT.DIM-1)/2)*PITCH,selY=measLayer*LAYER_GAP+CUBE*0.5;
  for(let kk=0;kk<RT.DIM&&v/6<cap;kk++){const p=src[(kk*RT.DIM+kk)*3];if(p<0.06||kk===sel)continue;
    const x=(kk-(RT.DIM-1)/2)*PITCH,z=(kk-(RT.DIM-1)/2)*PITCH,y=(measLayer-1)*LAYER_GAP+CUBE*0.5;
    pos[v++]=x;pos[v++]=y;pos[v++]=z;pos[v++]=selX;pos[v++]=selY;pos[v++]=selZ;}
  for(let i=v;i<pos.length;i++)pos[i]=0;
  RT.netLines.geometry.setDrawRange(0,v/3);RT.netLines.geometry.attributes.position.needsUpdate=true;
}
function applyThreshold(){ // rewrite matrices of already-built cells to honor brightness threshold
  if(!RT.cellMesh||RT.builtStage<0)return;let inst=0;
  for(let L=0;L<=RT.builtStage;L++){const cells=RT.layerCell[L],baseY=L*LAYER_GAP;
    for(let r=0;r<RT.DIM;r++)for(let c=0;c<RT.DIM;c++){
      const vis=cells[(r*RT.DIM+c)*3]>=VS.threshold;
      dummy.position.set((c-(RT.DIM-1)/2)*PITCH,baseY,(r-(RT.DIM-1)/2)*PITCH);
      dummy.scale.set(vis?1:0,vis?1:0,vis?1:0);dummy.updateMatrix();
      RT.cellMesh.setMatrixAt(inst++,dummy.matrix);}}
  RT.cellMesh.instanceMatrix.needsUpdate=true;
}
// Per-frame stack update: lay the group on its side for horizontal orientation,
// build instances up to the current stage (or all layers when showFull), reveal
// only the stage the playhead has reached, and refresh the network lines.
function updateStack(dt){
  RT.floorMesh.visible=VS.floorGrid;RT.floorGrid.visible=VS.floorGrid;
  if(VS.floorGrid&&RT.floorGrid.material){floorPulse+=dt*0.6;RT.floorGrid.material.opacity=0.06+0.05*(0.5+0.5*Math.sin(floorPulse));}
  grp.scale.setScalar(1);                                   // tower stays put: no shape/size animation
  grp.rotation.set(0,0,VS.stackAxis==='horizontal'?-Math.PI/2:0); // lay the stack on its side for horizontal
  const cs=currentStageFor(VS.stageTime);
  buildStackUpTo(VS.showFull?RT.totalLayers-1:cs);             // BUILD instances (showFull → all are ready instantly)
  const showStage=Math.min(cs,RT.builtStage);                  // shown layers ALWAYS follow the scrub/playhead → reveal one at a time
  RT.cellMesh.count=showStage<0?0:layerEnd(showStage);
  RT.edgeLines.geometry.setDrawRange(0,showStage<0?0:edgeEnd(showStage));
  drawStackNetwork(cs);
}

/* ════════ FLOOR view (tucked-away morphing grid) ════════ */
// Phase accumulator for the animated floor grid opacity.
let floorPulse=0;
// Floor-field view: a single ρ grid laid flat, cell height proportional to |ρ|,
// rebuilt every frame from the current animation frame's state. Draws the same
// measurement network lines as the stack when a collapse is in view.
function updateFloor(frame,dt){
  grp.scale.setScalar(1);grp.rotation.set(0,0,0);          // floor field is always flat
  RT.floorMesh.visible=true;RT.floorGrid.visible=true;
  floorPulse+=dt*0.6;
  if(RT.floorGrid.material){RT.floorGrid.material.opacity=0.06+0.05*(0.5+0.5*Math.sin(floorPulse));} // animated floor grid
  const cells=frame?densityToCell(frame.state):RT.layerCell[0];
  const sel=selectedOutcomeIndex();const meas=frame&&frame.measurement;const CUT=heatCut(),ghosts=ghostsEnabled();
  let si=0,ei=0;
  for(let r=0;r<RT.DIM;r++)for(let c=0;c<RT.DIM;c++){
    const k=(r*RT.DIM+c)*3;const mag=cells[k],re=cells[k+1],im=cells[k+2];const isSel=(meas&&sel>=0&&r===sel&&c===sel);
    if(mag>=CUT||isSel){
      let col=cellColor(mag,re,im),gv=mag;if(isSel){col=[255,250,235];gv=1;}
      const h=Math.max(0.012,mag*MAXH);
      dummy.position.set((c-(RT.DIM-1)/2)*PITCH,0,(r-(RT.DIM-1)/2)*PITCH);dummy.scale.set(1,h/CUBE,1);dummy.updateMatrix();
      RT.cellMesh.setMatrixAt(si,dummy.matrix);_col.setRGB(col[0]/255,col[1]/255,col[2]/255,THREE.SRGBColorSpace).multiplyScalar(glowGain(gv));RT.cellMesh.setColorAt(si,_col);si++;
    }else if(ghosts){                                       // zero → flat clean edges; dropped at 7+ qubits
      ei=writeBoxEdges(RT.edgeBuf,ei,(c-(RT.DIM-1)/2)*PITCH,0,(r-(RT.DIM-1)/2)*PITCH,0.06);
    }
  }
  RT.cellMesh.count=si;RT.cellMesh.instanceMatrix.needsUpdate=true;if(RT.cellMesh.instanceColor)RT.cellMesh.instanceColor.needsUpdate=true;
  RT.edgeLines.geometry.setDrawRange(0,ei);RT.edgeLines.geometry.attributes.position.needsUpdate=true;
  if(VS.network&&meas&&sel>=0){
    RT.netLines.visible=true;const pos=RT.netLines.geometry.attributes.position.array;let v=0;
    const selX=(sel-(RT.DIM-1)/2)*PITCH,selZ=(sel-(RT.DIM-1)/2)*PITCH,selY=Math.max(0.05,cells[(sel*RT.DIM+sel)*3]*MAXH);
    const pre=RT.layerCell[Math.max(0,RT.totalLayers-2)];
    for(let kk=0;kk<RT.DIM;kk++){const p=pre[(kk*RT.DIM+kk)*3];if(p<0.06||kk===sel)continue;
      const x=(kk-(RT.DIM-1)/2)*PITCH,z=(kk-(RT.DIM-1)/2)*PITCH,y=Math.max(0.05,p*MAXH);
      pos[v++]=x;pos[v++]=y;pos[v++]=z;pos[v++]=selX;pos[v++]=selY+0.3;pos[v++]=selZ;}
    for(let i=v;i<pos.length;i++)pos[i]=0;
    RT.netLines.geometry.setDrawRange(0,v/3);RT.netLines.geometry.attributes.position.needsUpdate=true;
  } else RT.netLines.visible=false;
}


export { updateStack, updateFloor };
