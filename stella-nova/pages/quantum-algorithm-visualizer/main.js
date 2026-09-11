// QAVE entry point: keeps orchestration only — the rebuild()/loop() pipeline
// and the boot sequence. Every subsystem lives in its own module; main wires
// RT.rebuild/RT.loadPreset, runs each init in order, then starts the loop.
//   grep -n "function rebuild" main.js   grep -n "function loop" main.js
import { VS, RT, controls, composer, currentStageFor, stageDuration, stageFrame, totalStackTime } from './core.js';
import { buildTrace } from './quantum.js';
import { presetGates, PRESET_N, densityToCell } from './presets.js';
import { rebuildMeshes, frameCamera, resize, initScene } from './scene.js';
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
// the sampler, then render through the bloom composer.
function loop(t){requestAnimationFrame(loop);const dt=Math.min((t-last)/1000,0.05);last=t;
  fc++;ft+=dt;if(ft>=0.5){document.getElementById('st-fps').textContent=Math.round(fc/ft)+' fps';fc=0;ft=0;}
  if(RT.trace){
    if(VS.threshDirty){RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];VS.threshDirty=false;}  // re-pack with the new heat cutoff
    const sc=document.getElementById('sl-scrub');
    if(VS.viewMode==='stack'){
      if(VS.playing){VS.stageTime+=dt*VS.speed;if(VS.stageTime>=totalStackTime())VS.stageTime=0;}
      updateStack(dt);
      const stage=currentStageFor(VS.stageTime),sf=stageFrame(stage);
      drawLens(sf);updateHud(sf);
      if(document.activeElement!==sc){const f=VS.stageTime/Math.max(1e-6,totalStackTime());sc.value=Math.round(f*100);sc.style.setProperty('--pct',(f*100)+'%');document.getElementById('vl-scrub').textContent=Math.round(f*100)+'%';}
    } else {
      if(VS.playing){VS.frameIndex+=VS.speed*TL_FPS*dt;if(VS.frameIndex>=RT.trace.frames.length)VS.frameIndex=0;}
      const fi=Math.max(0,Math.min(RT.trace.frames.length-1,Math.floor(VS.frameIndex))),frame=RT.trace.frames[fi];
      updateFloor(frame,dt);drawLens(frame);updateHud(frame);
      if(document.activeElement!==sc){const f=fi/Math.max(1,RT.trace.frames.length-1);sc.value=Math.round(f*100);sc.style.setProperty('--pct',(f*100)+'%');document.getElementById('vl-scrub').textContent=Math.round(f*100)+'%';}
    }
    followPlayhead();
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
