// ============================================================================
//  ATOMIC ORBITAL VR  ·  hydrogenic orbital as a live particle cloud
// ----------------------------------------------------------------------------
//  Samples the hydrogen wavefunction ψ(n,ℓ,m) as hundreds of thousands of GPU
//  points, colors each by |ψ|², Re(ψ), Im(ψ) or phase, and animates the points
//  along the probability current. On top of the cloud it computes a magnetic
//  field from that current (discrete Biot-Savart) and draws it as arrows and
//  advected tracers. The whole scene is grabbable in WebXR immersive-ar with a
//  world-space control panel poked by the fingertip.
//
//  MODULE MAP  (this file is the entry; each subsystem is its own ES module)
//  ----------------------------------------------------------------------------
//      core.js ......... S, isMobile, scene/camera/renderer/controls,
//                        orbitalGroup, scene scaffold, RT runtime state
//      physics.js ...... pure wavefunction math + colormaps
//      cdf.js .......... inverse-CDF radial + theta samplers
//      particles.js .... buffers, pSystem, startRebuild/startGrow/spawnChunk/
//                        updateColors/animateFlow/rebuildStaticFlow
//      bfield.js ....... computeBField/sampleBField/uploadBArrows + arrows
//      tracers.js ...... flow tracers + B-field tracers
//      arpanel.js ...... world-space canvas GUI + hand dots
//      gestures.js ..... hand tracking / pinch + handleVRInput
//      arsession.js .... immersive-ar session (window._arUpdate*)
//      ui.js ........... panel/slider DOM wiring (initUI) + setters
//
//  RENDER LOOP  (renderer.setAnimationLoop) — orchestration kept here
//  ----------------------------------------------------------------------------
//      hidden? skip : dt = min(delta, MAX_DT)
//      dirty? rebuild : spawnChunk ▶ evolve colors ▶ animateFlow ▶ tracers
//      ▶ periodic B recompute ▶ nucleus spin ▶ XR input ▶ AR panel ▶ render
//
//  OPENING LOOK  pickLook(rng, mode) draws one orbital from LOOKS and a camera
//  angle. A normal visit draws from Math.random and always opens on |psi|^2
//  (mode 0); the screensaver draws from opts.seed and also draws the color
//  mode. A URL that names an orbital (#n=4&l=2&m=1, see
//  readQNHash in ui.js) wins over the random draw.
//
//  VIEW AND TONE  Each state is drawn with its r99 (the radius that holds 99
//  percent of the probability) at VIEW_R = 3 scene units: S.scale =
//  VIEW_R / r99, set in startRebuild (particles.js). The camera distance is
//  fitDistance(aspect) in core.js, so r99 fills 70 percent of the half-size
//  of the short screen axis on a desktop, a phone or the 9:16 saver column.
//  Color is toneMap (physics.js) with the per-state tone from buildTone
//  (cdf.js): density over its 99.5 percent value, asinh curve, median at 0.5.
//
//  SCREENSAVER  window.snSaver (end of file), for lib/screensaver.js. The
//  hook sends saverPlate() to opts.label: n, l, m, the subshell, the explicit
//  radial factor R_nl, E_n, the node counts and the Biot-Savart sum.
//
//  grep -n targets: "const LOOKS" | "function pickLook" | "function mulberry"
//                   "window.snSaver" | "hashchange" | "function saverPlate"

// ============================================================================
import * as THREE from 'three';
import { renderer, scene, camera, controls, orbitalGroup, S, RT,
         nucleusGroup, bgDimMesh, pointScale } from './core.js';
import { startRebuild, spawnChunk, updateColors, animateFlow, pMat } from './particles.js';
import { computeBField } from './bfield.js';
import { updateFlowTracers, updateBTracers } from './tracers.js';
import { updateARPanel } from './arpanel.js';
import { buildRadialCDF } from './cdf.js';
import { handleVRInput } from './gestures.js';
import { initUI, syncQN, applyQN, setAnimate, setColorMode, readQNHash } from './ui.js';
import './arsession.js';   // side effect: wires the AR button + window._arUpdate*

// Bind the DOM controls and run the initial setters (setMagField / setAnimate
// and the slider syncs) in the original order.
initUI();

// Paces the periodic Biot-Savart recompute; owned by the render loop alone.
let bFieldFrameCount=0;

// Frame clock.
const clock=new THREE.Clock();
// Largest step one frame can take, in seconds. After a stall or a hidden
// tab, the loop continues from the last state and does not replay the gap.
const MAX_DT=0.1;
// When the page is hidden, the loop does no work. On return, the clock
// restarts, so the first frame does not get the hidden time as dt.
let pageHidden=document.hidden;
document.addEventListener('visibilitychange',()=>{pageHidden=document.hidden;clock.getDelta();});
// Guarantee material size matches state regardless of initialization order.
pMat.size = S.psize;
// First fill of the cloud.
startRebuild();

// The per-frame loop, driven by WebXR when in a session and by rAF otherwise.
// Order: rebuild if dirty, otherwise stream/evolve/animate the cloud, update the
// tracers and periodic B solve, spin the nucleus, then handle XR input, the AR
// panel, and the passthrough dim plane before rendering.
renderer.setAnimationLoop((time, frame)=>{
  const rawDt=clock.getDelta();
  // Stop here while hidden. An XR session continues, because the headset
  // can show the page when the 2D document is hidden.
  if(pageHidden&&!renderer.xr.isPresenting)return;
  const dt=Math.min(rawDt,MAX_DT);

  // Quantum state changed → full clear and rebuild
  if(S.dirty){S.dirty=false;S.colDirty=false;RT.colorRollIdx=0;startRebuild();return;}

  // Grow/shrink particle count each frame
  spawnChunk();

  // Time-evolve phase (rolling window so large counts stay smooth)
  if(S.evolving&&S.colorMode!==0){S.simTime+=dt*S.timeSpeed*12;updateColors();}
  else if(S.colDirty){S.colDirty=false;RT.colorRollIdx=0;updateColors();}

  // Animate particle positions along J
  if(S.animateFlow&&S.m!==0){
    animateFlow(dt);
    if(S.colorMode!==0) updateColors();
  }

  // Flow tracers
  updateFlowTracers(dt);

  // B field: periodic recompute
  if(S.showBField){
    bFieldFrameCount++;
    if(bFieldFrameCount>=S.bUpdateEvery){
      bFieldFrameCount=0;
      if(!RT.bFieldScheduled){RT.bFieldScheduled=true;setTimeout(computeBField,0);}
    }
  }

  // B-field tracers
  updateBTracers(dt);

  // Nucleus spin animation
  nucleusGroup.children.forEach(c=>{if(c.userData.spinSpeed)c.rotateOnAxis(c.userData.spinAxis,c.userData.spinSpeed*dt);});

  handleVRInput(frame);
  if(frame && window._arUpdateHitTest) _arUpdateHitTest(frame);
  if(window._arUpdateScale) _arUpdateScale(dt);
  updateARPanel(frame);
  // Point size: S.psize times the portrait factor. The AR session sets
  // its own size, so this runs only outside XR.
  if(!renderer.xr.isPresenting) pMat.size=S.psize*pointScale();
  // Safety: clamp scale back to 1 if something collapsed it outside AR mode
  if(!document.body.classList.contains('ar-mode') && orbitalGroup.scale.x < 0.05)
    orbitalGroup.scale.setScalar(1);
  // Track bgDimMesh to camera so it always covers the full AR passthrough background
  if(bgDimMesh.visible){
    bgDimMesh.position.copy(camera.position);
    bgDimMesh.quaternion.copy(camera.quaternion);
    bgDimMesh.translateZ(-10);
  }
  controls.update();
  renderer.render(scene,camera);
});

// Orbitals that look good as a first view. All have m != 0: an m = 0 state
// has no probability current, so it has no flow and no B streamers.
const LOOKS=[[2,1,1],[3,1,1],[3,2,1],[3,2,2],[4,1,1],[4,2,1],[4,2,2],
             [4,3,1],[4,3,2],[4,3,3],[5,2,1],[5,3,1],[5,3,2],[5,4,2],[5,4,3]];
// Color modes for the draw. |psi|^2 and Phase show the shape best, so they
// have two entries each.
const LOOK_MODES=[0,0,3,3,1,2];

// Small seeded generator (mulberry32). Returns floats in [0,1).
function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// Draw one look: an orbital from LOOKS (the sign of m is random), a color
// mode (the given one, else a draw from LOOK_MODES), and a camera azimuth and
// elevation on the default orbit radius.
function pickLook(rng, fixedMode){
  const q=LOOKS[Math.floor(rng()*LOOKS.length)];
  const m=rng()<0.5?q[2]:-q[2];
  const drawn=LOOK_MODES[Math.floor(rng()*LOOK_MODES.length)];
  const mode=fixedMode==null?drawn:fixedMode;
  const az=rng()*Math.PI*2, el=0.08+rng()*0.32;
  const R=Math.hypot(camera.position.x,camera.position.y,camera.position.z);
  applyQN(q[0],q[1],m); S.dirty=true;
  setColorMode(mode);
  camera.position.set(R*Math.cos(el)*Math.sin(az),R*Math.sin(el),R*Math.cos(el)*Math.cos(az));
  controls.target.set(0,0,0); controls.update();
}

// First view. A URL that names an orbital wins; other visits get a random
// orbital. The page always opens on |psi|^2 (mode 0).
const linked=readQNHash();
if(linked){applyQN(linked[0],linked[1],linked[2]);S.dirty=true;setColorMode(0);}
else pickLook(Math.random,0);

// The shell sets the page hash on back, forward and a pasted link.
window.addEventListener('hashchange',()=>{
  const q=readQNHash(); if(!q) return;
  if(q[0]===S.n&&q[1]===S.l&&q[2]===S.m) return;
  applyQN(q[0],q[1],q[2]); S.dirty=true;
});

// Screensaver plate (opts.label) for the orbital on screen. The facts come
// from physics.js: radialR uses ρ = 2r/n and the generalized Laguerre
// polynomial L_k^(2l+1)(ρ), k = n-l-1. particleColor uses the phase
// m·φ - t/(2n²), so E_n = -1/(2n²) hartree = -13.6 eV/n². The angle θ is
// from the vertical (y) axis of the scene.
const SUB_LETTERS=['s','p','d','f','g','h'];
const SUP={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
const SUBS={'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};
const sup=v=>String(v).split('').map(c=>SUP[c]||c).join('');
const sub=v=>String(v).split('').map(c=>SUBS[c]||c).join('');
function fact(k){let r=1;for(let i=2;i<=k;i++)r*=i;return r;}
function binom(a,b){return b<0||b>a?0:fact(a)/(fact(b)*fact(a-b));}
// k!·L_k^α(ρ) = Σ_i (-1)^i C(k+α, k-i) (k!/i!) ρ^i, all integer terms.
function laguerreText(k,alpha){
  if(k===0) return '1';
  const terms=[];
  for(let i=0;i<=k;i++){
    const c=binom(k+alpha,k-i)*fact(k)/fact(i);
    const pw=i===0?'':(i===1?'ρ':'ρ'+sup(i));
    const mag=(c===1&&i>0)?pw:c+pw;
    terms.push((i%2?' − ':(terms.length?' + ':''))+mag);
  }
  const body=terms.join('');
  return k===1?'('+body+')':'('+body+')/'+fact(k);
}
function saverPlate(){
  const{n,l,m}=S, am=Math.abs(m), k=n-l-1, ms=(m>0?'+':'')+m;
  const name=n+(SUB_LETTERS[l]||'?');
  const rhoPart=(l===0?'':(l===1?'ρ':'ρ'+sup(l)))+'e^(−ρ/2)';
  const lag=k===0?'':' · '+laguerreText(k,2*l+1);
  const E=-13.6057/(n*n);
  const mode=['|ψ|²','Re ψ','Im ψ','phase arg ψ'][S.colorMode]||'|ψ|²';
  // params, the page's TeX (index.html data-tex) and its RULES from
  // equations.js: n m1, ell m2, m m3, B m4, psi m5, J m6. eq is the plain
  // fallback. The anchor is orbitalAnchor() below.
  return {
    title:'Hydrogen '+name+' orbital',
    sub:'Color: '+mode,
    params:[{sym:'n',name:'shell',value:String(n),cls:'m1'},
      {sym:'\\ell',name:'angular, '+(SUB_LETTERS[l]||'?'),value:String(l),cls:'m2'},
      {sym:'m',name:'magnetic',value:ms.replace('-','−'),cls:'m3'},
      {sym:'E_n',name:'energy',value:'−13.6 eV / '+n+'² = '+E.toFixed(2).replace('-','−')+' eV'}],
    lines:['Nodes: '+k+' radial (n − ℓ − 1), '+l+' angular (ℓ).',
      'R'+sub(n)+sub(l)+'(r) ∝ '+rhoPart+lag+', ρ = 2r / '+n+'a₀'],
    tex:['\\psi_{n,\\ell,m}(r,\\theta,\\varphi) \\;=\\; R_{n,\\ell}(r)\\,Y_{\\ell}^{m}(\\theta,\\varphi)',
      '\\hat{H}\\,\\psi_{n,\\ell,m} \\;=\\; E_{n}\\,\\psi_{n,\\ell,m}',
      '\\vec{B}(\\vec{r}) \\;=\\; \\frac{\\mu_0}{4\\pi}\\sum_{i} \\frac{\\vec{J}_i \\times (\\vec{r}-\\vec{r}_i)}{|\\vec{r}-\\vec{r}_i|^{3}}'],
    rules:[['n','m1'],['\\ell','m2'],['m','m3'],['\\vec{B}','m4'],['\\psi','m5'],['\\vec{J}_i','m6']],
    eq:[
      'ψ'+sub(n)+sub(l)+(m<0?'₋':'')+sub(am)+' = R'+sub(n)+sub(l)+'(r) · Y'+sub(l)+(m<0?'₋':'')+sub(am)+'(θ,φ) · e^(−iE'+sub(n)+'t/ħ)',
      'R'+sub(n)+sub(l)+'(r) ∝ '+rhoPart+lag,
      'ρ = 2r / '+n+'a₀ (a₀ = Bohr radius)',
      'Y'+sub(l)+(m<0?'₋':'')+sub(am)+' ∝ P'+sub(l)+sup(am)+'(cos θ) e^('+(m<0?'−':'')+'i'+(am===1?'':am)+'φ)',
      'B(r) = μ₀/4π Σᵢ Jᵢ × (r − rᵢ) / |r − rᵢ|³',
    ],
    anchor:orbitalAnchor,
  };
}
// The orbital on screen, for the shell's label plate. The particles sit at
// r·S.scale in orbitalGroup, with r drawn from buildRadialCDF(n, l). The
// radius in the scene is the r that holds 90 percent of the probability
// (the bright cloud), times S.scale. The centre (the nucleus) and a point
// that far along the camera's right axis are projected with the page
// camera to canvas px. The key point is the nucleus.
let anchorKey='',anchorR3=0;
const _c=new THREE.Vector3(),_e=new THREE.Vector3(),_rt=new THREE.Vector3();
function orbitalAnchor(){
  const key=S.n+','+S.l;
  if(key!==anchorKey){
    const d=buildRadialCDF(S.n,S.l);let i=0;while(i<d.M-1&&d.cdf[i]<0.9)i++;
    anchorR3=i*d.rMax/(d.M-1);anchorKey=key;
  }
  const cv=renderer.domElement,b=cv.getBoundingClientRect();
  orbitalGroup.updateMatrixWorld();
  _c.setFromMatrixPosition(orbitalGroup.matrixWorld);
  _rt.setFromMatrixColumn(camera.matrixWorld,0).normalize();
  _e.copy(_c).addScaledVector(_rt,anchorR3*S.scale*orbitalGroup.scale.x);
  _c.project(camera);_e.project(camera);
  if(_c.z>1||Math.abs(_c.x)>1.2||Math.abs(_c.y)>1.2)return null;
  const x=b.left+(_c.x+1)/2*b.width,y=b.top+(1-_c.y)/2*b.height;
  const ex=b.left+(_e.x+1)/2*b.width,ey=b.top+(1-_e.y)/2*b.height;
  return {x,y,r:Math.hypot(ex-x,ey-y),pts:[{x,y}]};
}

// Screensaver hook for the shell (lib/screensaver.js). It hides the GUI, draws
// one look from opts.seed, and turns on a slow camera orbit. opts.calm
// (1 = slowest) scales the orbit, flow and tracer speeds. The shell reloads
// the page on stop, so enter() does not keep the old values.
window.snSaver={
  enter(o){
    const calm=Math.max(0,Math.min(1,o&&o.calm!=null?o.calm:0.7));
    const st=document.createElement('style');
    st.textContent='body>*:not(#c){display:none!important}';
    document.head.appendChild(st);
    pickLook(mulberry((o&&o.seed!=null?o.seed:Math.random()*1e9)|0));
    setAnimate(true);
    S.flowSpeed=0.5*(1-0.6*calm);
    S.timeSpeed=1-0.6*calm;
    S.bTrSpeed=1-0.5*calm;
    controls.autoRotate=true;
    controls.autoRotateSpeed=0.15+0.6*(1-calm);
    renderer.setClearColor(0x0e1118,1);
    // One orbital plays for the whole visit, so one plate is enough.
    if(o&&typeof o.label==='function') o.label(saverPlate());
    return {canvas:document.getElementById('c'),warmupMs:2500};
  }
};
