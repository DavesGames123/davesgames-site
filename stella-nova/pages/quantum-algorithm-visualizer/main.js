// QAVE entry point: keeps orchestration only — the rebuild()/loop() pipeline
// and the boot sequence. Every subsystem lives in its own module; main wires
// RT.rebuild/RT.loadPreset, runs each init in order, then starts the loop.
//   grep -n "function rebuild" main.js   grep -n "function loop" main.js
//   grep -n "window.snSaver" main.js   (screensaver hook for lib/screensaver.js)
//   grep -n "function saverPlate" main.js   (its label plate: algorithm, size, gate)
import { VS, RT, controls, composer, currentStageFor, stageDuration, stageFrame, totalStackTime } from './core.js';
import { buildTrace } from './quantum.js';
import { presetGates, PRESET_N, densityToCell } from './presets.js';
import { rebuildMeshes, frameCamera, resize, initScene, tickScale } from './scene.js';
import { updateStack, updateFloor } from './views.js';
import { drawLens, followPlayhead, revealMode, initLens } from './lens.js';
import { updateHud, updateHudStatic, initHud } from './hud.js';
import { updateSampling, stopSampling, initSampling } from './sampling.js';
import { initUI, clampQ, renderList, setQiskitFromState } from './ui.js';

// Rebuild everything after any circuit change: run buildTrace, derive one ρ cell
// buffer per layer, reset the instance cache, rebuild meshes, and refresh the HUD.
// keepPos restores the current playhead position so edits do not jump the view.
function rebuild(keepPos){
  if(typeof stopSampling==='function')stopSampling();const hp=document.getElementById('hist-panel');if(hp)hp.classList.remove('show');
  if(VS.gates.length===0){RT.trace=null;VS.frameIndex=0;renderList();return;}
  const prevStage=(keepPos&&RT.trace)?currentStageFor(VS.stageTime):0;
  const prevFrac=(keepPos&&RT.trace&&RT.trace.frames.length>1)?VS.frameIndex/(RT.trace.frames.length-1):0;
  RT.trace=buildTrace({numQubits:VS.numQubits,gates:VS.gates},{substeps:VS.substeps,seed:VS.seed,initBasis:RT.initBasis});
  RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];document.getElementById('sl-scrub').max=100;
  RT.DIM=1<<VS.numQubits;
  RT.layerStates=[RT.trace.frames[0].state].concat(RT.trace.steps.map(s=>s.endState));
  RT.totalLayers=RT.layerStates.length;
  RT.layerCell=RT.layerStates.map(densityToCell);
  if(keepPos){const s=Math.max(0,Math.min(RT.totalLayers-1,prevStage));
    VS.stageTime=s*stageDuration()+1e-3;
    VS.frameIndex=Math.max(0,Math.min(RT.trace.frames.length-1,prevFrac*(RT.trace.frames.length-1)));
    revealMode();
  }else{VS.frameIndex=0;VS.stageTime=0;}
  rebuildMeshes();if(!keepPos)frameCamera();renderList();updateHudStatic();
  document.getElementById('st-dim').textContent=RT.DIM+'×'+RT.DIM+' cells';
  document.getElementById('st-layers').textContent=RT.totalLayers+' layer'+(RT.totalLayers>1?'s':'');
}
// Load a named algorithm: set its qubit count if fixed, generate its gates,
// highlight its button, rebuild, and mirror the code into the Qiskit editor.
function loadPreset(name){VS.preset=name;RT.initBasis=0;if(PRESET_N[name]){VS.numQubits=PRESET_N[name];clampQ();}VS.gates=presetGates(name,VS.numQubits);
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));rebuild();setQiskitFromState();}

/* ════════ loop ════════ */
// FPS bookkeeping; TL_FPS is the nominal frame rate the floor timeline steps at.
let last=0,fc=0,ft=0;const TL_FPS=26;
// Main render loop: advance the playhead (stack stage or floor frame index),
// update the active view, redraw the score and HUD, sync the scrub slider, run
// the sampler, then render through the bloom composer. In the screensaver the
// score, HUD and slider are hidden, so the loop skips them (RT.saver).
function loop(t){requestAnimationFrame(loop);const dt=Math.min((t-last)/1000,0.05);last=t;tickScale(t);
  if(!RT.saver){fc++;ft+=dt;if(ft>=0.5){document.getElementById('st-fps').textContent=Math.round(fc/ft)+' fps';fc=0;ft=0;}}
  if(RT.trace){
    if(VS.threshDirty){RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];VS.threshDirty=false;}  // re-pack with the new heat cutoff
    const sc=document.getElementById('sl-scrub');
    if(VS.viewMode==='stack'){
      if(VS.playing){VS.stageTime+=dt*VS.speed;if(VS.stageTime>=totalStackTime())VS.stageTime=0;}
      updateStack(dt);
      const stage=currentStageFor(VS.stageTime),sf=stageFrame(stage);
      if(!RT.saver){drawLens(sf);updateHud(sf);}
      if(!RT.saver&&document.activeElement!==sc){const f=VS.stageTime/Math.max(1e-6,totalStackTime());sc.value=Math.round(f*100);sc.style.setProperty('--pct',(f*100)+'%');document.getElementById('vl-scrub').textContent=Math.round(f*100)+'%';}
    } else {
      if(VS.playing){VS.frameIndex+=VS.speed*TL_FPS*dt;if(VS.frameIndex>=RT.trace.frames.length)VS.frameIndex=0;}
      const fi=Math.max(0,Math.min(RT.trace.frames.length-1,Math.floor(VS.frameIndex))),frame=RT.trace.frames[fi];
      updateFloor(frame,dt);if(!RT.saver){drawLens(frame);updateHud(frame);}
      if(!RT.saver&&document.activeElement!==sc){const f=fi/Math.max(1,RT.trace.frames.length-1);sc.value=Math.round(f*100);sc.style.setProperty('--pct',(f*100)+'%');document.getElementById('vl-scrub').textContent=Math.round(f*100)+'%';}
    }
    if(!RT.saver)followPlayhead();
    if(RT.sampleAnim)updateSampling(dt);
  }
  controls.update();composer.render();}

// expose the two orchestration entry points so subsystem handlers can call them
RT.rebuild=rebuild;RT.loadPreset=loadPreset;
// run each subsystem init once, in the original wiring order, before boot
initScene();initLens();initHud();initSampling();initUI();
if(window.ResizeObserver)new ResizeObserver(resize).observe(document.getElementById('gl-host'));else window.addEventListener('resize',resize);


// Boot: size to the host, clamp selections, load the default algorithm, start the loop.
resize();clampQ();loadPreset('qft');requestAnimationFrame(loop);

// Screensaver hook for the shell (lib/screensaver.js). It pins #gl-host to the
// window (resize() sizes the drawing buffer from the host), hides the GUI and
// the overlay canvases, and loads one algorithm from opts.seed. opts.calm
// (1 = slowest) scales the playhead and the auto-orbit. No exit(): the shell
// reloads the page on stop.
const SAVER_PRESETS=['qft','ghz','grover','scramble','iqft'];
// The plate for opts.label (the shell draws it at the lower right). ALGO holds
// the name and the equation of each saver preset, as presetGates builds it.
// The live lines come from RT.trace: the step that stageFrame shows, its gate,
// its qubits, and the largest population of the state after that step.
const ALGO={
  qft:{name:'Quantum Fourier transform',sub:'H and RZ prepare a phase pattern, then QFT',
    eq:['QFT|x⟩ = (1/√2ⁿ) Σₖ e^(2πi·xk/2ⁿ) |k⟩',
        'built from H, CP(π/2ᵈ) and the final SWAPs',
        'CP(λ): RZ(λ/2)ᶜ, CX, RZ(−λ/2)ᵗ, CX, RZ(λ/2)ᵗ in time order']},
  iqft:{name:'Inverse quantum Fourier transform',sub:'H on every qubit, then QFT†',
    eq:['QFT†|k⟩ = (1/√2ⁿ) Σₓ e^(−2πi·xk/2ⁿ) |x⟩',
        'Hⁿ|0…0⟩ = QFT|0…0⟩, so QFT† returns |0…0⟩',
        'CP(−π/2ᵈ) phases, then the final SWAPs']},
  ghz:{name:'GHZ state',sub:'H on q0, then a CX fan-out, then measure',
    eq:['|GHZ⟩ = (|0…0⟩ + |1…1⟩) / √2',
        'CX|c,t⟩ = |c, t ⊕ c⟩',
        'ρ: 4 nonzero cells, 2 populations and 2 coherences']},
  grover:{name:'Grover search, 3 qubits',sub:'oracle marks |111⟩, then one diffusion step',
    eq:['Oracle: CCZ = I − 2|111⟩⟨111| (H · CCX · H)',
        'Diffusion: H³X³ · CCZ · X³H³ = I − 2|s⟩⟨s|',
        'P(|111⟩) = sin²3θ = 25/32, sin θ = 1/√8']},
  scramble:{name:'Scrambler circuit',sub:'H, RZ phases, a CX ring, H, a CZ chain',
    eq:['|ψ⟩ = Π CZ · Hⁿ · CX ring · Π RZ(φ_q) · Hⁿ |0…0⟩',
        'RZ(φ) = diag(e^(−iφ/2), e^(iφ/2))',
        'CZ = diag(1, 1, 1, −1)']},
};
const GATE_EQ={h:'H = (1/√2)[[1, 1], [1, −1]]',x:'X = [[0, 1], [1, 0]]',cx:'CX|c,t⟩ = |c, t ⊕ c⟩',
  cz:'CZ = diag(1, 1, 1, −1)',ccx:'CCX|a,b,t⟩ = |a, b, t ⊕ ab⟩',swap:'SWAP|a,b⟩ = |b,a⟩',
  rz:'RZ(φ) = diag(e^(−iφ/2), e^(iφ/2))',ry:'RY(φ) = [[cos φ/2, −sin φ/2], [sin φ/2, cos φ/2]]',
  measure:'P(b) = |⟨b|ψ⟩|², then |ψ⟩ → |b⟩'};
function gateText(st){
  if(!st)return 'start state |'+RT.initBasis.toString(2).padStart(VS.numQubits,'0')+'⟩';
  const nm=st.name.toUpperCase(),c=st.controls||[],t=st.targets||[];
  if(st.kind==='measurement')return 'Measure q'+t.join(',q')+(st.selectedOutcome!=null?' → |'+st.selectedOutcome+'⟩':'');
  let s=nm+(st.params&&st.params.length?'('+st.params[0].toFixed(3).replace('-','−')+')':'');
  if(c.length)s+=' control q'+c.join(',q')+' → target q'+t.join(',q');else s+=' on q'+t.join(',q');
  return s;
}
function saverPlate(){
  const a=ALGO[VS.preset]||{name:VS.preset,sub:'',eq:[]},n=VS.numQubits,tr=RT.trace;
  const stage=tr?currentStageFor(VS.stageTime):0,st=tr&&stage>0?tr.steps[stage-1]:null;
  const lines=[n+' qubits · '+VS.gates.length+' gates · ρ = '+RT.DIM+' × '+RT.DIM+' per layer',
    'Gate '+stage+' of '+VS.gates.length+': '+gateText(st)];
  const ps=RT.layerStates[stage];
  if(ps){let bi=0,bp=-1;for(let i=0;i<ps.re.length;i++){const p=ps.re[i]*ps.re[i]+ps.im[i]*ps.im[i];if(p>bp){bp=p;bi=i;}}
    lines.push('Largest population: |'+bi.toString(2).padStart(n,'0')+'⟩, P = '+bp.toFixed(3));}
  const eq=a.eq.slice();
  if(st&&GATE_EQ[st.name])eq.push(GATE_EQ[st.name]);
  eq.push('ρ = |ψ⟩⟨ψ|, one layer for each gate');
  return {title:a.name,sub:a.sub,lines,eq};
}
window.snSaver={
  enter(o){
    const calm=Math.max(0,Math.min(1,o&&o.calm!=null?o.calm:0.7));
    const st=document.createElement('style');
    st.textContent='body *{visibility:hidden!important;pointer-events:none!important}'+
      '#canvas-wrap,#gl-host{position:fixed!important;inset:0!important;z-index:2147483646}'+
      '#gl{visibility:visible!important;cursor:none!important}';
    document.head.appendChild(st);
    VS.stepInspect=false;VS.grid2d=false;VS.autoRotate=true;RT.saver=true;
    loadPreset(SAVER_PRESETS[Math.abs((o&&o.seed)|0)%SAVER_PRESETS.length]);
    VS.playing=true;VS.speed=2-1.4*calm;
    controls.autoRotate=true;controls.autoRotateSpeed=0.55*(1-0.5*calm);
    resize();
    // Plate: at most one call each second, and only when the text changes.
    if(o&&typeof o.label==='function'){let lastPlate='';
      const tick=()=>{const p=saverPlate(),j=JSON.stringify(p);if(j!==lastPlate){lastPlate=j;o.label(p);}};
      tick();setInterval(tick,1000);}
    return {canvas:document.getElementById('gl'),warmupMs:1500};
  }
};
