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

// ═══════════════════ THREE.JS SETUP ═══════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0, 0, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(S.dpr);
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

const material = new THREE.ShaderMaterial({
  vertexShader, fragmentShader, uniforms,
  transparent:true, side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending
});

// Atmosphere
const atmosphereUniforms = {
  uColor:{value:new THREE.Color(S.primaryEnergy)},
  uGlow:{value:S.atmosphereGlow},
  uLevel:{value:S.atmosphereLevel}
};
const atmosphereMaterial = new THREE.ShaderMaterial({
  vertexShader: SH['shaders/atmosphere.vert.glsl'],
  fragmentShader: SH['shaders/atmosphere.frag.glsl'],
  uniforms:atmosphereUniforms,
  transparent:true, side:THREE.FrontSide, depthWrite:false, blending:THREE.AdditiveBlending
});

const geometry = new THREE.SphereGeometry(2.0, 128, 128);
const orb = new THREE.Mesh(geometry, material);
scene.add(orb);

const atmosphereMesh = new THREE.Mesh(geometry, atmosphereMaterial);
atmosphereMesh.scale.setScalar(S.atmosphereScale);
orb.add(atmosphereMesh);

// Post-processing
const composer = new EffectComposer(renderer);
composer.setPixelRatio(S.dpr);
composer.addPass(new RenderPass(scene, camera));

const ChromaticAberrationShader = {
  uniforms:{"tDiffuse":{value:null},"uAmount":{value:S.chromaticAberration}},
  vertexShader: SH['shaders/chromatic-aberration.vert.glsl'],
  fragmentShader: SH['shaders/chromatic-aberration.frag.glsl']
};
const caPass = new ShaderPass(ChromaticAberrationShader);
composer.addPass(caPass);

// ═══════════════════ APPLY STATE → UNIFORMS ═══════════════════
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
  renderer.setPixelRatio(S.dpr);
  composer.setPixelRatio(S.dpr);
}

// ═══════════════════ UI SYNC ═══════════════════
function sg(el){
  const min=parseFloat(el.min),max=parseFloat(el.max),val=parseFloat(el.value);
  el.style.setProperty('--pct',((val-min)/(max-min)*100)+'%');
}

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
window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  composer.setSize(innerWidth,innerHeight);
});

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
