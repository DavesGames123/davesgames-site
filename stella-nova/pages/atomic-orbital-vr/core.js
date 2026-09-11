/* ════════════════════════════════════════════════════════════
   CORE — shared singletons for the whole page
   The state object S, the mobile flag, the THREE renderer / scene /
   camera / controls, the scene-graph scaffold (starfield, orbital
   group, bounding cube, reticle, background dimmer, nucleus), and
   RT for reassignable cross-module runtime state.
   Nothing here depends on a subsystem module.
   GREP: isMobile | S | scene | camera | renderer | controls
         orbitalGroup | boundingCube | reticle | bgDimMesh
         nucleusGroup | RT
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── STATE ── */
// Coarse mobile check, used to trim defaults on small or touch devices.
export const isMobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)||innerWidth<768;
// S is the single mutable state object. Every control writes into S; the render
// loop and the update functions read from it. dirty forces a full cloud rebuild;
// colDirty forces a recolor pass without moving any particle.
export const S={
  n:3,l:1,m:1,
  N:100000, scale:0.13,
  colorMode:0, scaler:800,
  evolving:true, timeSpeed:1, simTime:0,
  viewMode:0, cutAxis:1, cutPos:0,
  // Flow
  animateFlow:true, showFlowTr:false, flowSpeed:0.5,
  flowTrCount:400, flowTrTrail:30,
  // B field — on by default at max resolution, minimum arrow scale, fast update
  showBField:true, bGridDim:24, bGridExtent:40,
  bArrowScale:0.1, bColGamma:1.0, bUpdateEvery:10,
  showBTr:true, bTrSpeed:1.0, bTrSpawn:750, bTrTrail:50,
  // Misc
  showFlow:false, showAxes:false,
  psize:0.035,
  dirty:true, colDirty:false,
};

/* ── RT: reassignable cross-module runtime state ──
   ES import bindings are read-only, so any top-level `let` that more than one
   module reassigns lives here as a property and is written as RT.x=… everywhere. */
export const RT={
  liveCount:0,     // particles currently rendered
  targetCount:0,   // what we're growing toward
  spawning:false,
  colorRollIdx:0,  // rolling window pointer for chunked color updates
  bFieldData:null, // Float32Array [x,y,z,dx,dy,dz,mag × ng]
  bFieldDim:7,
  bFieldExt:25*S.scale,
  bFieldScheduled:false, // guards against >1 deferred Biot-Savart solve
  flowTracers:[],  // live probability-flow tracers
  bTracers:[],     // live B-field tracers
};

/* ── THREE.JS SETUP ── */
// Renderer: alpha true so AR passthrough can show through; xr.enabled turns on
// the WebXR animation path. Pixel ratio capped at 2 to bound fill cost.
const canvas=document.getElementById('c');
export const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.setClearColor(0x0e1118,1); // AR will override to transparent
renderer.xr.enabled=true;

export const scene=new THREE.Scene();
export const camera=new THREE.PerspectiveCamera(68,innerWidth/innerHeight,.01,100000);
camera.position.set(0,1.8,8.5);

// Desktop orbit controls. Re-enabled on XR session end since AR disables them.
export const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,0,0);controls.enableDamping=true;controls.dampingFactor=.05;
controls.minDistance=.3;controls.maxDistance=60;
renderer.xr.addEventListener('sessionend',()=>controls.enabled=true);

// Starfield: a fixed shell of faint bluish points for depth on the black ground.
// Scoped in a block so its scratch arrays do not leak into module scope.
{const N=2200,pos=new Float32Array(N*3),col=new Float32Array(N*3);for(let i=0;i<N;i++){const R=90+Math.random()*130,th=Math.random()*Math.PI,ph=Math.random()*6.28;pos[i*3]=R*Math.sin(th)*Math.cos(ph);pos[i*3+1]=R*Math.cos(th);pos[i*3+2]=R*Math.sin(th)*Math.sin(ph);const t=Math.random();col[i*3]=.4+.6*t;col[i*3+1]=.6+.4*t;col[i*3+2]=1;}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));scene.add(new THREE.Points(g,new THREE.PointsMaterial({size:.07,vertexColors:true,transparent:true,opacity:.5,sizeAttenuation:true})));}

// Orbital group — everything that should be grabbable/scaleable lives here.
// AR gestures move, scale, and rotate this one node so the whole scene follows.
export const orbitalGroup = new THREE.Group();
scene.add(orbitalGroup);

/* ── AR: Bounding cube wireframe — contains the orbital in physical space ── */
export const boundingCube = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(6,6,6)),
  new THREE.LineBasicMaterial({color:0x96c8ff,transparent:true,opacity:0.22,
    blending:THREE.AdditiveBlending,depthWrite:false})
);
boundingCube.visible=false;
orbitalGroup.add(boundingCube);

/* ── AR: Surface reticle — yellow ring shown on detected surfaces ── */
const reticleGeo = new THREE.RingGeometry(0.07,0.11,36);
reticleGeo.rotateX(-Math.PI/2);
export const reticle = new THREE.Mesh(reticleGeo,
  new THREE.MeshBasicMaterial({color:0xffc832,transparent:true,opacity:0.9,
    side:THREE.DoubleSide,depthWrite:false}));
reticle.matrixAutoUpdate=false;
reticle.visible=false;
scene.add(reticle);

/* Background dim plane — large black plane that follows camera.
   depthWrite:false lets 3D objects draw on top; only background pixels are dimmed. */
const bgDimGeo = new THREE.PlaneGeometry(1000, 1000);
export const bgDimMat = new THREE.MeshBasicMaterial({
  color:0x000000, transparent:true, opacity:0,
  depthTest:false, depthWrite:false, side:THREE.DoubleSide
});
export const bgDimMesh = new THREE.Mesh(bgDimGeo, bgDimMat);
bgDimMesh.renderOrder = -1000;
bgDimMesh.frustumCulled = false;
bgDimMesh.visible = false;
scene.add(bgDimMesh);

// Nucleus: a small glowing core sphere plus three tilted rings that spin about
// random axes (userData carries each ring's axis and speed for the loop).
export const nucleusGroup=new THREE.Group();orbitalGroup.add(nucleusGroup);
nucleusGroup.add(new THREE.Mesh(new THREE.SphereGeometry(.055,20,20),new THREE.MeshBasicMaterial({color:0x96c8ff,transparent:true,opacity:.9})));
for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.RingGeometry(.09+i*.04,.10+i*.04,48),new THREE.MeshBasicMaterial({color:0x5a8cc0,transparent:true,opacity:.18-i*.04,side:THREE.DoubleSide}));ring.rotation.x=Math.random()*Math.PI;ring.rotation.y=Math.random()*Math.PI;ring.userData.spinSpeed=(.4+Math.random()*.4)*(Math.random()>.5?1:-1);ring.userData.spinAxis=new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();nucleusGroup.add(ring);}
