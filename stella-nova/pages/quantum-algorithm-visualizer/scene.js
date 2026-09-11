// QAVE scene: backgrounds (setBg), mesh (re)build (rebuildMeshes/buildLabels),
// camera framing (frameCamera), viewport (resize/applyAutoOrient/applyMobileLayout),
// GPU helpers (writeBoxEdges/disposeGroup/edgeColor3), and the init-state picker.
//   grep -n "function rebuildMeshes" scene.js   grep -n "function frameCamera" scene.js
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VS, RT, scene, renderer, camera, controls, composer, grp, canvas, PITCH, CUBE, LAYER_GAP, MAXH, BARMAX, dummy, _col, _EH, _EI, ghostsEnabled, maxBuildableStage } from './core.js';
import { heatColor } from './color.js';

function bgGrad(c0,c1,c2){const cv=document.createElement('canvas');cv.width=4;cv.height=512;const g=cv.getContext('2d');
  const grd=g.createLinearGradient(0,0,0,512);grd.addColorStop(0,c0);grd.addColorStop(0.5,c1);grd.addColorStop(1,c2);
  g.fillStyle=grd;g.fillRect(0,0,4,512);const tx=new THREE.CanvasTexture(cv);tx.colorSpace=THREE.SRGBColorSpace;return tx;}
// Background presets: each returns a fresh color or gradient texture.
const BGS={navy:()=>bgGrad('#16294d','#0d1830','#05070f'),black:()=>new THREE.Color(0x000000),slate:()=>new THREE.Color(0x12161e),
  steel:()=>new THREE.Color(0x2a3340),dusk:()=>bgGrad('#2a1a3e','#1a1530','#0a0812'),paper:()=>new THREE.Color(0xe8ecf2)};
// Apply a background: set the scene texture, match the renderer clear color, and
// mark the active swatch.
function setBg(name){if(!BGS[name])return;VS.bg=name;scene.background=BGS[name]();
  const solid={black:0x000000,slate:0x12161e,steel:0x2a3340,paper:0xe8ecf2,navy:0x0a0d14,dusk:0x0a0812};renderer.setClearColor(solid[name]??0x0a0d14,1);
  document.querySelectorAll('.bg-sw').forEach(b=>b.classList.toggle('active',b.dataset.bg===name));}
function writeBoxEdges(buf,voff,cx,cy,cz,h){              // write one cube's 12 edges as line-segment verts
  const x0=cx-_EH,x1=cx+_EH,z0=cz-_EH,z1=cz+_EH,y0=cy,y1=cy+h;
  const C=[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
  let p=voff*3;for(let i=0;i<24;i++){const v=C[_EI[i]];buf[p++]=v[0];buf[p++]=v[1];buf[p++]=v[2];}
  return voff+24;
}

// Free the GPU resources of a group before discarding it, to avoid leaks on rebuild.
function disposeGroup(g){if(!g)return;g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});}
function edgeColor3(){const c=heatColor(0.01);return new THREE.Color().setRGB(c[0]/255,c[1]/255,c[2]/255,THREE.SRGBColorSpace);} // 1% floor color for zero-cell ghosts

// Recreate every mesh for the current DIM and shape: the instanced ρ cells, the
// wireframe ghosts, the sampling glow/bars/marks, the step-inspector highlight,
// the floor and grid, the network lines, the basis labels, and the init picker.
function rebuildMeshes(){
  while(grp.children.length){const c=grp.children.pop();disposeGroup(c);}
  RT.histGroup=null;RT.histBars=null;RT.histMarks=null;
  RT.inspMesh=null;RT.lastInspStep=-99;RT.last2dLayer=-99;RT.grid2dDirty=true;
  const need=Math.max(RT.DIM*RT.DIM,RT.totalLayers*RT.DIM*RT.DIM);          // everything: every cell of every layer
  let geo;
  if(VS.shape==='box')geo=new THREE.BoxGeometry(CUBE,CUBE,CUBE);
  else if(VS.shape==='sphere')geo=new THREE.SphereGeometry(CUBE*0.6,12,9);
  else if(VS.shape==='octa')geo=new THREE.OctahedronGeometry(CUBE*0.72,0);
  else geo=new RoundedBoxGeometry(CUBE,CUBE,CUBE,1,CUBE*0.14);
  geo.translate(0,CUBE/2,0);
  const mat=new THREE.MeshBasicMaterial({toneMapped:false});
  RT.cellMesh=new THREE.InstancedMesh(geo,mat,need);RT.cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  RT.cellMesh.setColorAt(0,_col.setRGB(0.1,0.05,0.2,THREE.SRGBColorSpace));RT.cellMesh.count=0;RT.cellMesh.frustumCulled=false;grp.add(RT.cellMesh);
  // zero-probability ghosts: clean cube EDGES only (no face diagonals), transparent, at the 1% floor color
  const eneed=ghostsEnabled()?need:1;RT.edgeBuf=new Float32Array(eneed*72);   // 24 verts * 3 floats per cell
  const eg=new THREE.BufferGeometry();eg.setAttribute('position',new THREE.BufferAttribute(RT.edgeBuf,3).setUsage(THREE.DynamicDrawUsage));eg.setDrawRange(0,0);
  const emat=new THREE.LineBasicMaterial({color:edgeColor3(),transparent:true,opacity:0.24,depthWrite:false,toneMapped:false});
  RT.edgeLines=new THREE.LineSegments(eg,emat);RT.edgeLines.frustumCulled=false;grp.add(RT.edgeLines);
  // sampling glow: additive boxes over the diagonal (population) cells, lit one sample at a time
  const sgeo=new THREE.BoxGeometry(CUBE*1.14,CUBE*1.14,CUBE*1.14);
  const smat=new THREE.MeshBasicMaterial({transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  RT.sampleMesh=new THREE.InstancedMesh(sgeo,smat,RT.DIM);RT.sampleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  RT.sampleMesh.setColorAt(0,_col.setRGB(0,0,0,THREE.SRGBColorSpace));RT.sampleMesh.count=0;RT.sampleMesh.frustumCulled=false;grp.add(RT.sampleMesh);
  // sampling RESULTS as 3D bars rising from the DIAGONAL cells (the populations |ρ_ii|) of the sampling layer
  RT.histGroup=new THREE.Group();RT.histGroup.visible=false;
  const barW=PITCH*0.6,barD=PITCH*0.6;
  const bgeo=new THREE.BoxGeometry(barW,1,barD);bgeo.translate(0,0.5,0);   // grows up from its base
  RT.histBars=new THREE.InstancedMesh(bgeo,new THREE.MeshBasicMaterial({toneMapped:false}),RT.DIM);
  RT.histBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);RT.histBars.setColorAt(0,_col.setRGB(0.1,0.05,0.2,THREE.SRGBColorSpace));RT.histBars.count=0;RT.histBars.frustumCulled=false;RT.histGroup.add(RT.histBars);
  const mgeo=new THREE.BoxGeometry(barW*1.25,0.05,barD*1.25);              // amber crossbar = true |ψ|² target
  RT.histMarks=new THREE.InstancedMesh(mgeo,new THREE.MeshBasicMaterial({toneMapped:false}),RT.DIM);
  RT.histMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);RT.histMarks.setColorAt(0,_col.setRGB(1,0.72,0.28,THREE.SRGBColorSpace));RT.histMarks.count=0;RT.histMarks.frustumCulled=false;RT.histGroup.add(RT.histMarks);
  grp.add(RT.histGroup);   // child of grp → diagonal placement follows the stack orientation automatically
  // step-inspector highlight: tints the cells the active gate's operator couples (its support on the array)
  const icap=Math.min(RT.DIM*RT.DIM,RT.DIM*4+8);
  const igeo=new THREE.BoxGeometry(CUBE*1.08,CUBE*1.08,CUBE*1.08);
  const imat=new THREE.MeshBasicMaterial({transparent:true,opacity:0.5,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  RT.inspMesh=new THREE.InstancedMesh(igeo,imat,icap);RT.inspMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  RT.inspMesh.setColorAt(0,_col.setRGB(0,0,0,THREE.SRGBColorSpace));RT.inspMesh.count=0;RT.inspMesh.frustumCulled=false;grp.add(RT.inspMesh);
  // floor + grid (for floor-field view)
  const span=RT.DIM*PITCH;
  RT.floorMesh=new THREE.Mesh(new THREE.PlaneGeometry(span+PITCH,span+PITCH),new THREE.MeshBasicMaterial({color:0x05080f,transparent:true,opacity:0.7}));
  RT.floorMesh.rotation.x=-Math.PI/2;RT.floorMesh.position.y=-0.02;grp.add(RT.floorMesh);
  const pts=[],half=span/2;
  for(let r=0;r<=RT.DIM;r++){const z=(r-RT.DIM/2)*PITCH;pts.push(-half,0,z,half,0,z);}
  for(let c=0;c<=RT.DIM;c++){const x=(c-RT.DIM/2)*PITCH;pts.push(x,0,-half,x,0,half);}
  const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  RT.floorGrid=new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.08}));RT.floorGrid.frustumCulled=false;RT.floorMesh.frustumCulled=false;grp.add(RT.floorGrid);
  // network lines
  const ng=new THREE.BufferGeometry();ng.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(RT.DIM*6*2),3));
  RT.netLines=new THREE.LineSegments(ng,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.6,blending:THREE.AdditiveBlending,depthWrite:false}));
  RT.netLines.frustumCulled=false;grp.add(RT.netLines);
  buildLabels();
  ensureInitPicker();
}
// Build the basis-state labels (binary kets) along two edges of the grid, drawn as
// canvas-texture sprites. Skipped when DIM exceeds 16 (too many to read).
function buildLabels(){
  if(RT.labelGroup){disposeGroup(RT.labelGroup);}
  RT.labelGroup=new THREE.Group();grp.add(RT.labelGroup);
  if(RT.DIM>16)return;
  const span=RT.DIM*PITCH,half=span/2,n=VS.numQubits;
  const tex=t=>{const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d');
    x.clearRect(0,0,64,32);x.fillStyle='#7a8aa6';x.font='600 16px JetBrains Mono,monospace';x.textAlign='center';x.textBaseline='middle';x.fillText(t,32,16);
    const tx=new THREE.CanvasTexture(c);tx.minFilter=THREE.LinearFilter;return tx;};
  for(let i=0;i<RT.DIM;i++){const lbl=i.toString(2).padStart(n,'0');
    const a=new THREE.Sprite(new THREE.SpriteMaterial({map:tex(lbl),transparent:true,depthWrite:false}));
    a.position.set(-half-0.7,0.05,(i-(RT.DIM-1)/2)*PITCH);a.scale.set(1.1,0.55,1);RT.labelGroup.add(a);
    const b=new THREE.Sprite(new THREE.SpriteMaterial({map:tex(lbl),transparent:true,depthWrite:false}));
    b.position.set((i-(RT.DIM-1)/2)*PITCH,0.05,-half-0.7);b.scale.set(1.1,0.55,1);RT.labelGroup.add(b);}
  RT.labelGroup.visible=VS.labels;
}
// Position the camera to frame the whole structure for the active view and
// orientation, leaving room above the tower for the sampling bar chart.
function frameCamera(){
  const span=RT.DIM*PITCH;
  if(VS.viewMode==='stack'){
    const builtLayers=Math.min(RT.totalLayers,(typeof maxBuildableStage==='function'?maxBuildableStage():RT.totalLayers-1)+1);
    const sampling=!!RT.sampleAnim;
    const towerH=builtLayers*LAYER_GAP+(sampling?BARMAX+LAYER_GAP*1.4:0);   // leave room for the results bar chart
    if(VS.stackAxis==='horizontal'){            // layers run along world +X (0..towerH); grids stand upright in Y/Z
      const d=Math.max(span,towerH)*1.05+span*0.6+5;
      camera.position.set(towerH*0.5-span*0.15,span*0.72+4,d);
      controls.target.set(towerH*0.5,0,0);
    } else {                                    // tower grows up world +Y
      const d=Math.max(span,towerH)*1.15+span*0.5+5;
      camera.position.set(span*0.85+4,towerH*0.62+span*0.35,d);
      controls.target.set(0,towerH*0.45,0);
    }
  } else {
    camera.position.set(span*0.7,span*0.98,span*1.08);
    controls.target.set(0,0.3,0);
  }
  controls.update();
}
function applyAutoOrient(W,H){                              // wide window → horizontal stack, tall → vertical
  if(!VS.autoOrient)return;const want=(W/H>=1.2)?'horizontal':'vertical';
  if(want!==VS.stackAxis){VS.stackAxis=want;const b=document.getElementById('orient-btn');
    if(b)b.textContent=want==='horizontal'?'⬌ Horizontal (auto)':'⬍ Vertical (auto)';
    if(typeof frameCamera==='function')frameCamera();}
}
// Tracks the last mobile/desktop decision so the layout only switches on change.
let wasMobile=null;
function applyMobileLayout(W){                              // narrow viewport: kill the overlay panels (they cover the 3D view)
  const mob=W<760;if(mob===wasMobile)return;wasMobile=mob;
  if(mob){VS.stepInspect=false;VS.grid2d=false;
    document.getElementById('step-inspector').classList.remove('show');document.getElementById('grid2d-panel').classList.remove('show');
    const a=document.getElementById('tog-inspect'),b=document.getElementById('tog-grid2d');if(a)a.classList.remove('on');if(b)b.classList.remove('on');}
  else{VS.stepInspect=true;VS.grid2d=true;RT.grid2dDirty=true;RT.last2dLayer=-99;
    const a=document.getElementById('tog-inspect'),b=document.getElementById('tog-grid2d');if(a)a.classList.add('on');if(b)b.classList.add('on');}
}
// Match renderer, composer, and camera to the GL host size, then re-apply the
// auto orientation and mobile layout. Driven by a ResizeObserver on the host.
function resize(){const w=document.getElementById('gl-host');const W=w.clientWidth||600,H=w.clientHeight||400;renderer.setSize(W,H,false);composer.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();applyAutoOrient(W,H);applyMobileLayout(window.innerWidth||W);}

/* ════════ init-state picker — hover bottom grid (layer 0) for |b⟩, click to set the start state ════════ */
// Raycaster and scratch NDC vector for picking cells under the pointer.
const _ray=new THREE.Raycaster(),_ndc=new THREE.Vector2();
// pickPlane: invisible ground for the raycast; pickHi: hover highlight; diagGuide:
// the instanced markers on the diagonal (start-state candidates).
let pickPlane=null,pickHi=null,diagGuide=null,_downXY=null;
const DIAG_CAP=300;
const initTip=document.createElement('div');initTip.id='init-tip';
initTip.style.cssText='position:fixed;z-index:600;pointer-events:none;display:none;background:rgba(9,12,20,0.97);border:1px solid rgba(150,200,255,0.35);border-radius:7px;padding:7px 10px;font-family:JetBrains Mono,monospace;font-size:0.68rem;color:#cdd6e6;box-shadow:0 6px 22px rgba(0,0,0,0.55);max-width:230px;line-height:1.4';
document.body.appendChild(initTip);
// Lazily create the picker helpers (plane, highlight, diagonal guides) under grp.
function ensureInitPicker(){
  if(!grp)return;
  if(!pickPlane||pickPlane.parent!==grp){const pg=new THREE.PlaneGeometry(600,600);pickPlane=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({visible:false}));pickPlane.rotation.x=-Math.PI/2;pickPlane.frustumCulled=false;grp.add(pickPlane);}
  if(!pickHi||pickHi.parent!==grp){const hg=new THREE.BoxGeometry(PITCH*0.98,CUBE*1.14,PITCH*0.98);hg.translate(0,CUBE*0.5,0);
    pickHi=new THREE.Mesh(hg,new THREE.MeshBasicMaterial({color:0x9cc8ff,transparent:true,opacity:0.30,depthWrite:false,toneMapped:false}));pickHi.visible=false;pickHi.frustumCulled=false;grp.add(pickHi);}
  if(!diagGuide||diagGuide.parent!==grp){const dg=new THREE.BoxGeometry(PITCH*0.9,0.05,PITCH*0.9);dg.translate(0,0.02,0);
    diagGuide=new THREE.InstancedMesh(dg,new THREE.MeshBasicMaterial({transparent:true,opacity:0.4,depthWrite:false,toneMapped:false}),DIAG_CAP);
    diagGuide.setColorAt(0,_col.setRGB(0.27,0.78,0.95,THREE.SRGBColorSpace));diagGuide.count=0;diagGuide.frustumCulled=false;grp.add(diagGuide);}
  updateDiagGuide();
}
// Refresh the diagonal guide markers, raising and recoloring the current |b⟩.
function updateDiagGuide(){
  if(!diagGuide)return;const off=(RT.DIM-1)/2,n=Math.min(RT.DIM,DIAG_CAP);
  for(let i=0;i<n;i++){const sel=(i===RT.initBasis);dummy.position.set((i-off)*PITCH,0,(i-off)*PITCH);dummy.scale.set(1,sel?3.2:1,1);dummy.updateMatrix();diagGuide.setMatrixAt(i,dummy.matrix);
    if(sel)_col.setRGB(1,0.72,0.28,THREE.SRGBColorSpace).multiplyScalar(1.5);else _col.setRGB(0.27,0.78,0.95,THREE.SRGBColorSpace);diagGuide.setColorAt(i,_col);}
  diagGuide.count=n;diagGuide.instanceMatrix.needsUpdate=true;if(diagGuide.instanceColor)diagGuide.instanceColor.needsUpdate=true;
  diagGuide.visible=(VS.viewMode==='stack');
}
// Binary ket string for a basis index.
function ketStr(idx){return idx.toString(2).padStart(Math.max(1,VS.numQubits),'0');}
// Raycast the pointer onto layer 0 and return the (row, col) cell it hits, or null.
function pickRC(e){
  if(VS.viewMode!=='stack'||!grp){return null;}ensureInitPicker();
  const rect=canvas.getBoundingClientRect();
  _ndc.x=((e.clientX-rect.left)/rect.width)*2-1;_ndc.y=-((e.clientY-rect.top)/rect.height)*2+1;
  _ray.setFromCamera(_ndc,camera);const hit=_ray.intersectObject(pickPlane,false)[0];if(!hit)return null;
  const lp=grp.worldToLocal(hit.point.clone()),off=(RT.DIM-1)/2;
  const c=Math.round(lp.x/PITCH+off),r=Math.round(lp.z/PITCH+off);
  if(r<0||c<0||r>=RT.DIM||c>=RT.DIM)return null;return {r,c,off};
}
// Hide the init hover highlight and tooltip.
function hideInitHover(){if(pickHi)pickHi.visible=false;initTip.style.display='none';}
// On hover, highlight the cell and show a tooltip; only diagonal cells are pickable
// start states, off-diagonal cells just read out as coherences.
function onInitMove(e){
  const rc=pickRC(e);if(!rc){hideInitHover();return;}
  const {r,c,off}=rc,diag=(r===c);
  pickHi.position.set((c-off)*PITCH,0,(r-off)*PITCH);pickHi.material.color.setHex(diag?0x9cc8ff:0x5a7090);pickHi.material.opacity=diag?0.34:0.16;pickHi.visible=true;
  initTip.innerHTML = diag
    ? 'start state &nbsp;<b style="color:#9cc8ff">|'+ketStr(r)+'⟩</b>'+(r===RT.initBasis?' <span style="color:#64c864">(current)</span>':'')+'<div style="color:#7a8aa6;font-size:0.58rem;margin-top:3px">click to begin the circuit here</div>'
    : '⟨'+ketStr(r)+'|ρ₀|'+ketStr(c)+'⟩ coherence<div style="color:#7a8aa6;font-size:0.58rem;margin-top:3px">pick a diagonal cell to set the start state</div>';
  initTip.style.display='block';const pad=15,w=initTip.offsetWidth,h=initTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;
  initTip.style.left=x+'px';initTip.style.top=y+'px';
}


export function initScene(){
setBg('black');
// Picker pointer wiring: hover previews a start state; a click (not a drag) on a
// diagonal cell sets |b⟩ and rebuilds from there. The press/release distance test
// separates a pick from an orbit drag.
canvas.addEventListener('pointermove',onInitMove);
canvas.addEventListener('pointerleave',hideInitHover);
canvas.addEventListener('pointerdown',e=>{_downXY=[e.clientX,e.clientY];});
canvas.addEventListener('pointerup',e=>{if(!_downXY)return;const dx=e.clientX-_downXY[0],dy=e.clientY-_downXY[1];_downXY=null;
  if(dx*dx+dy*dy>25)return;                       // drag = orbit, not a pick
  const rc=pickRC(e);if(rc&&rc.r===rc.c){RT.initBasis=rc.r;RT.rebuild(true);VS.stageTime=0;VS.frameIndex=0;onInitMove(e);}
});
}

export { setBg, writeBoxEdges, disposeGroup, edgeColor3, rebuildMeshes, buildLabels, frameCamera, applyAutoOrient, applyMobileLayout, resize, ensureInitPicker, updateDiagGuide, hideInitHover };
