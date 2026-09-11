// QAVE core: shared state (VS, RT), THREE singletons (renderer/scene/camera/
// controls/composer/bloom), the grp group, layout constants, and small shared
// helpers (cellColor, roundRect, the stack-timing predicates). RT holds every
// reassignable cross-module value (trace, layer caches, DIM, mesh handles).
//   grep -n "const RT=" core.js   grep -n "function cellColor" core.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp01, heatColor, curveEval, C_CYAN, C_AMBER, phaseColorArr, densityColorReal, amplitudeColorArr } from './color.js';


// Final color for one ρ cell. The tone curve weights every mode; magnitude also
// picks a position on the heat ramp for |ρ| mode.
function cellColor(mag,re,im){
  const w=curveEval(clamp01(mag));                       // tone-curve (gamma) weight — now applied in EVERY color mode
  if(VS.colorMode==='real'){const c=densityColorReal(re);return [c[0]*w,c[1]*w,c[2]*w];}
  if(VS.colorMode==='phase'){const c=amplitudeColorArr(Math.atan2(im,re));return [c[0]*w,c[1]*w,c[2]*w];}
  return heatColor(0.01+0.99*w);                         // magnitude → heat ramp position, shaped by the curve
}
function smooth(t){t=clamp01(t);return t*t*(3-2*t);}

/* ════════ circuit model ════════ */
// VS is the single view/state object: the circuit (numQubits, gates), the current
// build selection, playback state, and every rendering/scene preference. UI writes
// into VS; rebuild(), the loop, and the draw functions read from it.
const VS={numQubits:4,gates:[],target:0,control:1,angle:Math.PI/2,seed:24,substeps:24,
  playing:true,speed:2,frameIndex:0,stageTime:0,holdTime:0.7,threshold:0,threshDirty:false,preset:'qft',colorMode:'mag',viewMode:'stack',
  autoRotate:true,floorGrid:false,network:true,labels:true,shape:'round',showFull:false,bg:'black',gamma:0.2,stackAxis:'vertical',autoOrient:true,stepInspect:true,grid2d:true};
// Derived render state. trace: the built simulation. layerStates/layerCell: one
// entry per layer (state and its ρ cells). builtStage/layerEndArr/edgeEndArr:
// the append-once cache of which cell/edge instances each layer occupies.
// initBasis: the chosen start basis state |b⟩ (0 = |0…0⟩).
const RT={trace:null,layerStates:[],layerCell:[],totalLayers:1,builtStage:-1,layerEndArr:[],edgeEndArr:[],initBasis:0,sampleAnim:null,DIM:8,cellMesh:null,edgeLines:null,edgeBuf:null,floorMesh:null,floorGrid:null,netLines:null,labelGroup:null,sampleMesh:null,histGroup:null,histBars:null,histMarks:null,inspMesh:null,lastInspStep:-99,last2dLayer:-99,grid2dDirty:true};
/* ════════ three.js scene ════════ */
// Renderer with exact color (no tone mapping); OutputPass later does linear→sRGB.
const canvas=document.getElementById('gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.setClearColor(0x0a0d14,1);                  // dark navy-black, matches #canvas-wrap
renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace; // exact colors, no highlight roll-off
const scene=new THREE.Scene(); // no fog: full grid stays visible at any size
// Build a vertical gradient texture for the gradient backgrounds.
// Camera and orbit controls. Auto-orbit pauses on user drag and resumes after 3.5 s.
const camera=new THREE.PerspectiveCamera(46,1,0.1,6000);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=0.08;controls.minDistance=4;controls.maxDistance=2000;
controls.autoRotate=true;controls.autoRotateSpeed=0.55;
controls.addEventListener('start',()=>{controls.autoRotate=false;clearTimeout(window._arT);});
controls.addEventListener('end',()=>{if(VS.autoRotate)window._arT=setTimeout(()=>controls.autoRotate=true,3500);});
// Soft fill plus two directional lights; cells use MeshBasicMaterial so lighting
// mostly shapes the edges and any lit non-basic geometry.
scene.add(new THREE.AmbientLight(0x556682,1.1));
const dir=new THREE.DirectionalLight(0xcfe6ff,0.8);dir.position.set(10,26,14);scene.add(dir);
const dir2=new THREE.DirectionalLight(0x4878b0,0.4);dir2.position.set(-12,10,-8);scene.add(dir2);
// ── bloom: high-probability cells blow past the threshold and glow red-hot ──
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),0.4,0.5,0.15); // strength halved (0.8→0.4): softer overall glow, still scales down the range
composer.addPass(bloom);
composer.addPass(new OutputPass());   // REQUIRED in r152+: applies tonemap + linear→sRGB; without it bg & heatmap colors render wrong

// grp holds every ρ mesh so orientation (vertical vs horizontal stack) is one
// group rotation. All the meshes below are (re)created by rebuildMeshes().
const grp=new THREE.Group();scene.add(grp);
// Layout constants: cell PITCH, cube size, max floor-field height, gap between layers.
const PITCH=1.0,CUBE=0.82,MAXH=4.4,LAYER_GAP=1.15;       // NO instance cap — render everything the circuit produces
const BARMAX=4.6;                                         // tallest sampling-histogram bar (world units)
const dummy=new THREE.Object3D(),_col=new THREE.Color();
// _EI lists the 8 cube corners paired into the 12 edges (24 vertex references),
// used to draw zero-probability cells as clean wireframes with no face diagonals.
const _EH=CUBE/2,_EI=[0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]; // 12 cube edges = 24 verts (no face diagonals)
function stageDuration(){return Math.max(0.06,VS.holdTime);}          // dwell per stage (seconds)
function totalStackTime(){return (RT.totalLayers+1)*stageDuration();}     // +1 = final hold before loop
function currentStageFor(t){return Math.max(0,Math.min(RT.totalLayers-1,Math.floor(t/stageDuration())));}
// Synthesize a settled frame object for a whole stack stage (used to drive the
// HUD and score without a per-substep frame).
function stageFrame(stage){const si=stage-1,st=RT.trace.steps[si];
  return {stepIndex:si,gateName:si<0?'init':(st?st.name:'?'),phase:'settle',measurement:!!(st&&st.kind==='measurement'),t:1,state:RT.layerStates[stage]};}
function maxBuildableStage(){return RT.builtStage<0?RT.totalLayers-1:RT.builtStage;}
function ghostsEnabled(){return VS.numQubits<=4;}          // 5+ qubits: render NOTHING for zero-probability cells (too dense otherwise)
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
const $=id=>document.getElementById(id);

export { VS, RT, renderer, scene, camera, controls, composer, bloom, grp, canvas, PITCH, CUBE, MAXH, LAYER_GAP, BARMAX, dummy, _col, _EH, _EI, $, cellColor, roundRect, ghostsEnabled, maxBuildableStage, stageDuration, totalStackTime, currentStageFor, stageFrame };
