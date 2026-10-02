// ============================================================================
//  FRACTAL ORB  ·  volumetric fractal rendered inside a sphere
// ----------------------------------------------------------------------------
//  A single sphere mesh carries a fragment shader that ray-marches a volumetric
//  fractal in the sphere's local space. A second, slightly larger sphere adds a
//  fresnel atmosphere. A post pass adds chromatic aberration. Two side panels
//  drive one shared state object S, which is pushed into GPU uniforms every time
//  a control changes.
//
//  RENDER PIPELINE
//  ---------------
//      scene ─┬─ orb mesh    SphereGeometry + ShaderMaterial (ray-march volume)
//             │                                        source: shaders/orb.*.glsl
//             └─ atmosphere  same geometry, scaled up, additive fresnel shell
//                                                source: shaders/atmosphere.*.glsl
//                      │
//                      ▼
//              EffectComposer
//                ├─ RenderPass(scene, camera)          draw the two meshes
//                └─ ShaderPass(chromatic aberration)   split RGB toward edges
//                                        source: shaders/chromatic-aberration.*.glsl
//                      │
//                      ▼
//                   <canvas>
//
//  PER-FRAGMENT RAY-MARCH   (inside shaders/orb.frag.glsl; drawn here for the map)
//  --------------------------------------------------------------------------
//      camera ●───ray───────────▶        rd = normalize(vLocalPosition - camPos)
//                 ╱   sphere r=2  ╲
//                (   •─▶─▶─▶─▶─•   )      getVolumeBounds() → [tNear, tFar]
//                 ╲   accumulate  ╱       traceEnergy() marches 64 steps, summing
//                  ╲────────────╱         emission = color · fractal-density
//
//  STATE FLOW
//  ----------
//      preset click / slider input ─▶ S ─▶ applyState() ─▶ uniforms ─▶ GPU
//                                       └─▶ syncAllUI()  ─▶ DOM widgets
//      animate(): uTime += dt·speed ; orb.rotation += dt·orbRotation ; render
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      shader load .......... "loadShaders"          fetch .glsl before build
//      presets .............. "PRESETS"              8 named parameter sets
//      state ................ "const S ="            the one mutable state object
//      pixel budget ......... "PIXEL_BUDGET"         cap on drawing-buffer pixels
//      three.js setup ....... "THREE.JS SETUP"       scene, camera, renderer
//      orb material ......... "const material ="      the ray-march ShaderMaterial
//      atmosphere ........... "atmosphereMaterial"   the fresnel shell
//      post processing ...... "ChromaticAberration"  the composer pass
//      state -> uniforms .... "function applyState"  push S into the GPU
//      state -> widgets ..... "function syncAllUI"   push S into the DOM
//      preset grid .......... "BUILD PRESET GRID"    build the preset buttons
//      control bindings ..... "BIND QUICK PANEL"     wire inputs back to S
//      animation loop ....... "function animate"     the per-frame update
//      screensaver hook ..... "SCREENSAVER HOOK"     window.snSaver for the shell
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { loadShaders } from '../../lib/shaders.js';

// Shader source lives in real .glsl files under shaders/. Fetch it all before
// building any material, so init runs in the original synchronous order.
const SH = await loadShaders(import.meta.url, [
  'shaders/orb.vert.glsl',
  'shaders/orb.frag.glsl',
  'shaders/atmosphere.vert.glsl',
  'shaders/atmosphere.frag.glsl',
  'shaders/chromatic-aberration.vert.glsl',
  'shaders/chromatic-aberration.frag.glsl',
]);

// Each preset is a complete snapshot of every tunable parameter. Selecting one
// copies its values into S wholesale; editing any control afterward switches the
// preset label to 'Custom'. Colours are hex; the rest feed shader uniforms.
// ═══════════════════ PRESETS ═══════════════════
const presets = {
  'Default': {
    primaryEnergy:'#00b3ff',secondaryEnergy:'#2e9aff',speed:0.5,density:3.0,dpr:0.7,
    atmosphereGlow:0.15,atmosphereLevel:1.0,atmosphereScale:1.03,orbRotation:0.89,
    internalAnim:0.43,fractalIters:4,fractalScale:0.97,fractalDecay:-16.7,
    smoothness:0.031,asymmetry:0.55,chromaticAberration:0.025
  },
  'Cyan': {
    primaryEnergy:'#00ffee',secondaryEnergy:'#9900ff',speed:0.5,density:1.1,dpr:0.7,
    atmosphereGlow:0.15,atmosphereLevel:1.0,atmosphereScale:1.03,orbRotation:0.89,
    internalAnim:0.43,fractalIters:3,fractalScale:0.75,fractalDecay:-16.7,
    smoothness:0.05,asymmetry:0.45,chromaticAberration:0.026
  },
  'Gray': {
    primaryEnergy:'#ffffff',secondaryEnergy:'#000000',speed:0.3,density:0.9,dpr:0.7,
    atmosphereGlow:0.15,atmosphereLevel:1.0,atmosphereScale:1.03,orbRotation:0.46,
    internalAnim:0.17,fractalIters:4,fractalScale:0.74,fractalDecay:-21.6,
    smoothness:0.036,asymmetry:0.0,chromaticAberration:0.017
  },
  'Yellow': {
    primaryEnergy:'#ffbb00',secondaryEnergy:'#2eff9d',speed:0.5,density:2.1,dpr:0.7,
    atmosphereGlow:0.15,atmosphereLevel:1.0,atmosphereScale:1.03,orbRotation:0.53,
    internalAnim:0.43,fractalIters:3,fractalScale:0.69,fractalDecay:-14.5,
    smoothness:0.008,asymmetry:0.35,chromaticAberration:0.024
  },
  'Green': {
    primaryEnergy:'#44ff00',secondaryEnergy:'#0062ff',speed:1.0,density:1.3,dpr:0.7,
    atmosphereGlow:0.15,atmosphereLevel:1.0,atmosphereScale:1.03,orbRotation:0.56,
    internalAnim:0.4,fractalIters:4,fractalScale:0.89,fractalDecay:-24.3,
    smoothness:0.081,asymmetry:0.26,chromaticAberration:0.0
  },
  'Ember': {
    primaryEnergy:'#ff3300',secondaryEnergy:'#ff8800',speed:0.4,density:2.5,dpr:0.7,
    atmosphereGlow:0.25,atmosphereLevel:0.85,atmosphereScale:1.04,orbRotation:0.35,
    internalAnim:0.55,fractalIters:5,fractalScale:0.82,fractalDecay:-13.0,
    smoothness:0.02,asymmetry:0.7,chromaticAberration:0.018
  },
  'Void': {
    primaryEnergy:'#8833ff',secondaryEnergy:'#110033',speed:0.2,density:1.8,dpr:0.7,
    atmosphereGlow:0.35,atmosphereLevel:0.7,atmosphereScale:1.05,orbRotation:0.25,
    internalAnim:0.15,fractalIters:6,fractalScale:1.1,fractalDecay:-10.0,
    smoothness:0.06,asymmetry:0.8,chromaticAberration:0.03
  },
  'Neutron': {
    primaryEnergy:'#e0e8ff',secondaryEnergy:'#4488ff',speed:1.0,density:3.5,dpr:0.7,
    atmosphereGlow:0.5,atmosphereLevel:0.9,atmosphereScale:1.02,orbRotation:1.0,
    internalAnim:0.8,fractalIters:3,fractalScale:0.6,fractalDecay:-20.0,
    smoothness:0.01,asymmetry:0.15,chromaticAberration:0.01
  }
};

// ═══════════════════ STATE ═══════════════════
const S = { preset:'Neutron', ...presets['Neutron'] };

// ═══════════════════ PIXEL BUDGET ═══════════════════
// The orb shader marches up to 64 steps per pixel, so the frame cost follows
// the drawing-buffer pixel count. S.dpr is a factor on the CSS size. The
// budget caps the product, so a large window (2560x1440 at dpr 1 is 3.7 Mpx)
// gets the same buffer as a laptop window. The volume is soft, so the lower
// resolution does not show.
const PIXEL_BUDGET = 1.3e6;
function pixelRatio(){
  const cap = Math.sqrt(PIXEL_BUDGET / Math.max(1, innerWidth * innerHeight));
  return Math.min(S.dpr, cap);
}

// Standard Three.js stack: a scene, a perspective camera 6 units out, and a
// WebGL renderer inserted before the #ui overlay so the canvas sits behind the
// panels. OrbitControls gives drag-to-orbit and scroll-to-zoom, with panning
// disabled so the orb stays centred.
// ═══════════════════ THREE.JS SETUP ═══════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0, 0, 6);

// No MSAA: the scene draws into the composer's render target, which has no
// samples, so a multisampled canvas only costs a resolve per frame.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(pixelRatio());
document.body.insertBefore(renderer.domElement, document.getElementById('ui'));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 15;

// ═══════════════════ SHADERS ═══════════════════
const vertexShader = SH['shaders/orb.vert.glsl'];

const fragmentShader = SH['shaders/orb.frag.glsl'];

// Uniforms are the live channel from JS state S into the GPU. Each field here
// mirrors one control; applyState() writes new values, animate() advances uTime
// and uLocalCamPos every frame.
const uniforms = {
  uTime:{value:0},
  uLocalCamPos:{value:new THREE.Vector3()},
  uPrimaryColor:{value:new THREE.Color(S.primaryEnergy)},
  uSecondaryColor:{value:new THREE.Color(S.secondaryEnergy)},
  uDensity:{value:S.density},
  uFractalIters:{value:S.fractalIters},
  uFractalScale:{value:S.fractalScale},
  uFractalDecay:{value:S.fractalDecay},
  uInternalAnim:{value:S.internalAnim},
  uSmoothness:{value:S.smoothness},
  uAsymmetry:{value:S.asymmetry}
};

// The orb material. Additive blending makes overlapping density read as light.
// Front faces only: the shader marches the full chord [tNear, tFar] from the
// front face, and a back face gets edgeAA = 0 (its normal points away from the
// camera), so DoubleSide paid for a second full march that added zero. The
// camera cannot enter the sphere (controls.minDistance 3 > radius 2).
const material = new THREE.ShaderMaterial({
  vertexShader, fragmentShader, uniforms,
  transparent:true, side:THREE.FrontSide, depthWrite:false, blending:THREE.AdditiveBlending
});

// Atmosphere
const atmosphereUniforms = {
  uColor:{value:new THREE.Color(S.primaryEnergy)},
  uGlow:{value:S.atmosphereGlow},
  uLevel:{value:S.atmosphereLevel}
};
// The atmosphere shell: the same sphere geometry scaled slightly larger, drawn
// front-side with additive blending so its fresnel rim reads as a soft glow.
const atmosphereMaterial = new THREE.ShaderMaterial({
  vertexShader: SH['shaders/atmosphere.vert.glsl'],
  fragmentShader: SH['shaders/atmosphere.frag.glsl'],
  uniforms:atmosphereUniforms,
  transparent:true, side:THREE.FrontSide, depthWrite:false, blending:THREE.AdditiveBlending
});

// One geometry shared by both meshes. The atmosphere is a child of the orb, so
// it inherits the orb's rotation and sits at atmosphereScale times its size.
const geometry = new THREE.SphereGeometry(2.0, 128, 128);
const orb = new THREE.Mesh(geometry, material);
scene.add(orb);

const atmosphereMesh = new THREE.Mesh(geometry, atmosphereMaterial);
atmosphereMesh.scale.setScalar(S.atmosphereScale);
orb.add(atmosphereMesh);

// Post-processing
const composer = new EffectComposer(renderer);
composer.setPixelRatio(pixelRatio());
composer.addPass(new RenderPass(scene, camera));

// Chromatic aberration post pass: samples the rendered frame three times with a
// small radial offset per channel, so bright edges fringe red/blue toward the rim.
const ChromaticAberrationShader = {
  uniforms:{"tDiffuse":{value:null},"uAmount":{value:S.chromaticAberration}},
  vertexShader: SH['shaders/chromatic-aberration.vert.glsl'],
  fragmentShader: SH['shaders/chromatic-aberration.frag.glsl']
};
const caPass = new ShaderPass(ChromaticAberrationShader);
composer.addPass(caPass);

// ═══════════════════ APPLY STATE → UNIFORMS ═══════════════════
// Push every value in S into the GPU uniforms and renderer. Called once at start
// and after any control change, so the render always reflects the current state.
function applyState(){
  uniforms.uPrimaryColor.value.set(S.primaryEnergy);
  uniforms.uSecondaryColor.value.set(S.secondaryEnergy);
  uniforms.uDensity.value=S.density;
  uniforms.uFractalIters.value=S.fractalIters;
  uniforms.uFractalScale.value=S.fractalScale;
  uniforms.uFractalDecay.value=S.fractalDecay;
  uniforms.uInternalAnim.value=S.internalAnim;
  uniforms.uSmoothness.value=S.smoothness;
  uniforms.uAsymmetry.value=S.asymmetry;
  atmosphereUniforms.uColor.value.set(S.primaryEnergy);
  atmosphereUniforms.uGlow.value=S.atmosphereGlow;
  atmosphereUniforms.uLevel.value=S.atmosphereLevel;
  atmosphereMesh.scale.setScalar(S.atmosphereScale);
  caPass.uniforms.uAmount.value=S.chromaticAberration;
  setRatio();
}
// Apply the pixel ratio only when it changes: setPixelRatio reallocates the
// composer targets, and the saver autopilot calls applyState every 50 ms.
let lastRatio=0;
function setRatio(){
  const r=pixelRatio();
  if(r===lastRatio)return;
  lastRatio=r;
  renderer.setPixelRatio(r);
  composer.setPixelRatio(r);
}

// ═══════════════════ UI SYNC ═══════════════════
// Paint a range input's filled portion: set the --pct custom property the CSS
// gradient reads, so the track shows progress up to the thumb.
function sg(el){
  const min=parseFloat(el.min),max=parseFloat(el.max),val=parseFloat(el.value);
  el.style.setProperty('--pct',((val-min)/(max-min)*100)+'%');
}

// The inverse of the bindings: write S back out to every widget (both panels),
// the preset highlight, and the readouts. Called after a preset load so the two
// panels and the state display all agree.
function syncAllUI(){
  // Quick panel
  document.getElementById('qp-col-pri').value=S.primaryEnergy;
  document.getElementById('qp-col-sec').value=S.secondaryEnergy;
  setSlider('qp-sl-spd','qp-vl-spd',S.speed,1);
  setSlider('qp-sl-den','qp-vl-den',S.density,1);
  setSlider('qp-sl-iter','qp-vl-iter',S.fractalIters,0);

  // Advanced panel
  document.getElementById('adv-col-pri').value=S.primaryEnergy;
  document.getElementById('adv-col-sec').value=S.secondaryEnergy;
  document.getElementById('adv-hex-pri').textContent=S.primaryEnergy;
  document.getElementById('adv-hex-sec').textContent=S.secondaryEnergy;
  setSlider('adv-spd','adv-vl-spd',S.speed,1);
  setSlider('adv-den','adv-vl-den',S.density,1);
  setSlider('adv-rot','adv-vl-rot',S.orbRotation,2);
  setSlider('adv-dpr','adv-vl-dpr',S.dpr,1);
  setSlider('adv-aglow','adv-vl-aglow',S.atmosphereGlow,2);
  setSlider('adv-alev','adv-vl-alev',S.atmosphereLevel,2);
  setSlider('adv-ascl','adv-vl-ascl',S.atmosphereScale,3);
  setSlider('adv-iter','adv-vl-iter',S.fractalIters,0);
  setSlider('adv-fscl','adv-vl-fscl',S.fractalScale,2);
  setSlider('adv-fdec','adv-vl-fdec',S.fractalDecay,1);
  setSlider('adv-ianim','adv-vl-ianim',S.internalAnim,2);
  setSlider('adv-smooth','adv-vl-smooth',S.smoothness,3);
  setSlider('adv-asym','adv-vl-asym',S.asymmetry,2);
  setSlider('adv-ca','adv-vl-ca',S.chromaticAberration,3);

  // Preset highlight
  document.querySelectorAll('.qp-preset').forEach(b=>{
    b.classList.toggle('active',b.dataset.preset===S.preset);
  });

  // State display
  document.getElementById('qp-preset-name').textContent=S.preset;
  document.getElementById('qp-ket').textContent=`Iter ${S.fractalIters} · ρ ${S.density.toFixed(1)}`;
  document.getElementById('qp-icon-preset').textContent=S.preset.substring(0,3).toUpperCase();
  document.getElementById('disp-preset').textContent=S.preset;
  document.getElementById('disp-info').textContent=`ITER ${S.fractalIters} · FRACTAL ENERGY`;
}

// Set one slider to a value: move the thumb, repaint the fill, and format the
// numeric readout to the given decimal places.
function setSlider(sliderId,valId,val,decimals){
  const el=document.getElementById(sliderId);
  el.value=val;
  sg(el);
  document.getElementById(valId).textContent=decimals===0?Math.round(val):val.toFixed(decimals);
}

// ═══════════════════ BUILD PRESET GRID ═══════════════════
const presetGrid=document.getElementById('preset-grid');
for(const name of Object.keys(presets)){
  const btn=document.createElement('button');
  btn.className='qp-preset'+(name===S.preset?' active':'');
  btn.dataset.preset=name;
  btn.innerHTML=`<span class="swatch" style="background:${presets[name].primaryEnergy}"></span>${name}`;
  btn.addEventListener('click',()=>{
    S.preset=name;
    Object.assign(S,presets[name]);
    applyState();
    syncAllUI();
  });
  presetGrid.appendChild(btn);
}

// ═══════════════════ BIND QUICK PANEL ═══════════════════
// Wire one quick-panel slider to S: on input, store the value under key, update
// its readout and fill, mark the preset Custom, and re-push state to the GPU.
function bindQP(sliderId,valId,key,decimals){
  const el=document.getElementById(sliderId);
  sg(el);
  el.addEventListener('input',function(){
    S[key]=parseFloat(this.value);
    document.getElementById(valId).textContent=decimals===0?Math.round(S[key]):S[key].toFixed(decimals);
    sg(this);
    S.preset='Custom';
    applyState();
    syncAllUI();
  });
}
bindQP('qp-sl-spd','qp-vl-spd','speed',1);
bindQP('qp-sl-den','qp-vl-den','density',1);
bindQP('qp-sl-iter','qp-vl-iter','fractalIters',0);

document.getElementById('qp-col-pri').addEventListener('input',function(){
  S.primaryEnergy=this.value;S.preset='Custom';applyState();syncAllUI();
});
document.getElementById('qp-col-sec').addEventListener('input',function(){
  S.secondaryEnergy=this.value;S.preset='Custom';applyState();syncAllUI();
});

// ═══════════════════ BIND ADVANCED PANEL ═══════════════════
// Same wiring for the advanced panel. applyFn lets a control run a custom apply
// step instead of the default applyState(), though here all use the default.
function bindAdv(sliderId,valId,key,decimals,applyFn){
  const el=document.getElementById(sliderId);
  sg(el);
  el.addEventListener('input',function(){
    S[key]=parseFloat(this.value);
    document.getElementById(valId).textContent=decimals===0?Math.round(S[key]):S[key].toFixed(decimals);
    sg(this);
    S.preset='Custom';
    if(applyFn)applyFn();else applyState();
    syncAllUI();
  });
}
bindAdv('adv-spd','adv-vl-spd','speed',1);
bindAdv('adv-den','adv-vl-den','density',1);
bindAdv('adv-rot','adv-vl-rot','orbRotation',2);
bindAdv('adv-dpr','adv-vl-dpr','dpr',1);
bindAdv('adv-aglow','adv-vl-aglow','atmosphereGlow',2);
bindAdv('adv-alev','adv-vl-alev','atmosphereLevel',2);
bindAdv('adv-ascl','adv-vl-ascl','atmosphereScale',3);
bindAdv('adv-iter','adv-vl-iter','fractalIters',0);
bindAdv('adv-fscl','adv-vl-fscl','fractalScale',2);
bindAdv('adv-fdec','adv-vl-fdec','fractalDecay',1);
bindAdv('adv-ianim','adv-vl-ianim','internalAnim',2);
bindAdv('adv-smooth','adv-vl-smooth','smoothness',3);
bindAdv('adv-asym','adv-vl-asym','asymmetry',2);
bindAdv('adv-ca','adv-vl-ca','chromaticAberration',3);

document.getElementById('adv-col-pri').addEventListener('input',function(){
  S.primaryEnergy=this.value;S.preset='Custom';applyState();syncAllUI();
});
document.getElementById('adv-col-sec').addEventListener('input',function(){
  S.secondaryEnergy=this.value;S.preset='Custom';applyState();syncAllUI();
});

// ═══════════════════ PANEL TOGGLES ═══════════════════
window.toggleQPCollapse=function(){
  document.getElementById('quick-panel').classList.toggle('qp-collapsed');
};
window.toggleAdv=function(){
  const panel=document.getElementById('adv-panel');
  const btn=document.getElementById('qp-adv-btn');
  panel.classList.toggle('adv-open');
  btn.classList.toggle('adv-open-active',panel.classList.contains('adv-open'));
};

// ═══════════════════ RESIZE ═══════════════════
// Keep the camera aspect and both render targets matched to the window size.
window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  composer.setSize(innerWidth,innerHeight);
  setRatio();
});

// The per-frame loop. It advances shader time by real elapsed seconds scaled by
// speed, spins the orb on two axes, recomputes the camera position in the orb's
// local frame (the shader ray-marches in local space), then renders through the
// composer. A once-per-second counter reports FPS.
// ═══════════════════ ANIMATION ═══════════════════
const clock=new THREE.Clock();
let frameCount=0,fpsTime=0;
const fpsEl=document.getElementById('fps');

function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  uniforms.uTime.value+=dt*S.speed;
  orb.rotation.y+=dt*S.orbRotation;
  orb.rotation.x+=dt*(S.orbRotation*0.5);
  orb.updateMatrixWorld();
  const localCam=new THREE.Vector3().copy(camera.position);
  orb.worldToLocal(localCam);
  uniforms.uLocalCamPos.value.copy(localCam);
  controls.update();
  composer.render();

  // FPS counter
  frameCount++;
  fpsTime+=dt;
  if(fpsTime>=1.0){
    fpsEl.textContent=Math.round(frameCount/fpsTime)+' FPS';
    frameCount=0;fpsTime=0;
  }
}

syncAllUI();
animate();

// ═══════════════════ SCREENSAVER HOOK ═══════════════════
// The shell's screensaver (lib/screensaver.js) calls snSaver.enter(opts). It
// hides the panels, loads a calm preset chosen by opts.seed, and slows time and
// spin by opts.calm (1 = slowest), with a floor so the volume never freezes. Every half dwell it eases the continuous
// fields toward the next calm preset over 8 s. fractalIters stays fixed, because
// an integer step would pop. Once a second it sends opts.label the fold and
// march equations with the live values. No storage, no URL writes.
const SAVER_PRESETS=['Void','Gray','Ember','Default','Cyan'];
const SAVER_EASE=['speed','density','atmosphereGlow','atmosphereLevel','atmosphereScale',
  'orbRotation','internalAnim','fractalScale','fractalDecay','smoothness','asymmetry','chromaticAberration'];
// The orb on screen, for the shell's label plate: the projected centre of
// the volume sphere (radius 2, the orb mesh), and the screen radius of its
// silhouette, R/sqrt(D^2 - R^2) over tan(fov/2), in page CSS px. project()
// includes the saver's view offset. No key
// points: the orb is one volume, so the leader ends at its edge.
const _orbC=new THREE.Vector3();
function orbAnchor(){
  const R=2, D=camera.position.length(); if(!(D>R)) return null;
  _orbC.set(0,0,0).project(camera); if(_orbC.z>1) return null;
  const h=innerHeight/2, t=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
  return { x:(_orbC.x+1)*innerWidth/2, y:(1-_orbC.y)*h, r:R/Math.sqrt(D*D-R*R)/t*h };
}
window.snSaver={
  enter(opts){
    const calm=Math.min(1,Math.max(0,opts.calm??0.7));
    const slow=1-0.7*calm;
    ['ui','fps'].forEach(id=>document.getElementById(id).style.display='none');
    document.querySelector('.grid-bg').style.display='none';
    // The scanline and vignette overlays sit over the canvas on screen only.
    const st=document.createElement('style');
    st.textContent='body::before,body::after{display:none}';
    document.head.appendChild(st);
    // One preset in calm form: speeds scaled by calm, aberration halved, dpr 1
    // (the pixel budget still caps the buffer on a large screen).
    // The internal churn turns at speed x internalAnim rad/s. Scaled by calm,
    // the calm presets fell to 0.01-0.08 rad/s (Void: one turn in 9 min), and
    // the volume looked frozen. A floor on that product and on the spin keeps
    // the orb alive; calm 1 still gives the slowest motion.
    const churnMin=0.35*(1-0.6*calm), spinMin=0.3*(1-0.6*calm);
    const calmOf=name=>{
      const p={...presets[name]};
      p.speed*=slow; p.orbRotation*=slow; p.internalAnim*=0.5+0.5*slow;
      p.speed=Math.max(p.speed,churnMin/p.internalAnim);
      p.orbRotation=Math.max(p.orbRotation,spinMin);
      p.chromaticAberration*=0.5; p.dpr=1;
      return p;
    };
    let i=(opts.seed>>>0)%SAVER_PRESETS.length;
    Object.assign(S,calmOf(SAVER_PRESETS[i]),{preset:SAVER_PRESETS[i]});
    // Pull the camera back so that the orb takes about 0.31 of the height
    // (0.44 of the width on a narrow screen). Then the label plate fits
    // beside the orb, not over it. Never closer than the page's 6 units.
    const fit=()=>{
      const h=innerHeight/2, t=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
      const r=Math.min(0.31*innerHeight,0.44*innerWidth);
      camera.position.setLength(Math.max(6,Math.hypot(2*h/(t*r),2)));
      // On a tall screen the shell docks the plate at the top, so move the
      // image of the orb down by 0.12 of the height (a view offset: the
      // camera and its orbit stay the same).
      const W=innerWidth,H=innerHeight;
      if(H>W) camera.setViewOffset(W,H,0,-Math.round(0.12*H),W,H); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
    fit(); addEventListener('resize',fit);
    applyState();
    // Autopilot: ease S toward the next preset, colours through THREE.Color.
    const c=new THREE.Color();
    const hold=Math.max(10,(opts.seconds||60)/2)*1000, ease=8000;
    let a=null,b=null,a1=new THREE.Color(),a2=new THREE.Color(),b1=new THREE.Color(),b2=new THREE.Color(),t0=0;
    const step=now=>{
      if(!a){ if(now-t0<hold) return;
        i=(i+1)%SAVER_PRESETS.length;
        a={...S}; b=calmOf(SAVER_PRESETS[i]); t0=now;
        a1.set(a.primaryEnergy); a2.set(a.secondaryEnergy); b1.set(b.primaryEnergy); b2.set(b.secondaryEnergy);
      }
      const k=Math.min(1,(now-t0)/ease), e=k*k*(3-2*k);
      for(const f of SAVER_EASE) S[f]=a[f]+(b[f]-a[f])*e;
      S.primaryEnergy='#'+c.copy(a1).lerp(b1,e).getHexString();
      S.secondaryEnergy='#'+c.copy(a2).lerp(b2,e).getHexString();
      applyState();
      if(k>=1){ a=null; t0=now; S.preset=SAVER_PRESETS[i]; }
    };
    t0=performance.now();
    this._timer=setInterval(()=>step(performance.now()),50);
    // The plate: the fold the shader runs (shaders/orb.frag.glsl,
    // evaluateStructure and traceEnergy) with the live values from S. The
    // same title refreshes the numbers once a second; a new preset name
    // gives a new title, so the plate fades to it. Colours: p and t m1
    // (ray), rho m2 (field), k and D m4, E m5 (emission), N, s, beta m6.
    const label=typeof opts.label==='function'?opts.label:null;
    const plate=()=>{
      if(!label) return;
      const f=(v,d)=>Number(v).toFixed(d);
      label({
        title:'Fractal orb · '+S.preset,
        sub:'Fold fractal, ray-marched in a sphere of radius 2',
        params:[
          {sym:'N',name:'folds',value:String(S.fractalIters),cls:'m6'},
          {sym:'s',name:'fold scale',value:f(S.fractalScale,2),cls:'m6'},
          {sym:'\\beta',name:'decay',value:f(S.fractalDecay,1),cls:'m6'},
          {sym:'k',name:'smoothness',value:f(S.smoothness,3),cls:'m4'},
          {sym:'D',name:'density',value:f(S.density,2),cls:'m4'},
        ],
        lines:[
          'Up to 64 march steps per pixel; colour out = ½ ln(1 + E)',
          a?'Easing to '+SAVER_PRESETS[i]:'Churn '+f(S.speed*S.internalAnim,2)+' rad/s, spin '+f(S.orbRotation,2)+' rad/s',
        ],
        tex:[
          '\\mathbf{q} = \\sqrt{\\mathbf{p}^2 + k}, \\qquad \\mathbf{p} \\leftarrow \\frac{s\\,\\mathbf{q}}{|\\mathbf{q}|^2} - s',
          '\\rho(\\mathbf{p}_0) = \\tfrac12 \\sum_{n=1}^{N} e^{\\beta\\,|\\mathbf{p}_n \\cdot \\mathbf{p}_0|}',
          'E \\leftarrow 0.99\\,E + 0.08\\,D\\,c(\\rho)\\,(1.8\\,\\rho + \\rho^2)',
          't \\leftarrow t + 0.02\\,e^{-2\\rho}',
        ],
        rules:[['\\mathbf{p}','m1'],['\\mathbf{q}','m1'],['t','m1'],['\\rho','m2'],['k','m4'],['D','m4'],['E','m5'],['N','m6'],['s','m6'],['\\beta','m6']],
        eq:[
          'q = √(p² + k),  p ← s·q/|q|² − s',
          '(y, z) ← (y² − z², 2yz),  (x, y, z) ← (z, x, y)',
          'ρ(p₀) = ½ Σₙ exp(β·|p·p₀|),  n = 1…'+S.fractalIters,
          'E ← 0.99·E + 0.08·D·c(ρ)·(1.8ρ + ρ²)',
          't ← t + 0.02·e^(−2ρ)  (march step)',
        ],
        anchor:orbAnchor,
      });
    };
    plate();
    this._plate=setInterval(plate,1000);
    return { canvas:renderer.domElement, warmupMs:500 };
  },
  exit(){ clearInterval(this._timer); clearInterval(this._plate); }
};
