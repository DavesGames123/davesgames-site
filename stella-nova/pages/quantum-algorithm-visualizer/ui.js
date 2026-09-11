// QAVE ui: all left-panel and dock wiring exported as initUI() — gate palette,
// presets, view/mode/shape/colormap/background, transport, sliders, tone-curve
// editor, and the Qiskit code panel. clampQ/renderList/setQiskitFromState are
// shared with main. grep -n "export function initUI" ui.js
import { VS, RT, $, currentStageFor, stageDuration, totalStackTime } from './core.js';
import { rebuildMeshes, frameCamera, setBg, edgeColor3, applyAutoOrient, updateDiagGuide, hideInitHover, resize } from './scene.js';
import { updateHudStatic } from './hud.js';
import { revealMode } from './lens.js';
import { stopSampling } from './sampling.js';
import { CMAPS, setActiveHeat, buildCurve, CURVE, curveEval, heatColor } from './color.js';
import { parseQiskit, gatesToQiskit, highlightQiskit } from './qiskit.js';


/* ════════ Qiskit programming (hidden dock panel) ════════ */
// Toggle the Qiskit panel open/closed and refresh highlighting when shown.

/* ---- Qiskit: codegen for the active algorithm + live syntax highlighting ---- */
// Repaint the highlight layer from the textarea and keep the two scroll-aligned.
function syncQiskitHL(){const ta=document.getElementById('qiskit-src'),hl=document.getElementById('qiskit-hl');hl.innerHTML=highlightQiskit(ta.value);hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;}
function setQiskitFromState(){                              // mirror the active algorithm into the editor (read-only display)
  const ta=document.getElementById('qiskit-src');ta.value=gatesToQiskit(VS.gates,VS.numQubits);ta.readOnly=true;
  document.getElementById('qiskit-custom').hidden=false;document.getElementById('qiskit-run').hidden=true;
  const msg=document.getElementById('qiskit-msg');msg.textContent='live code for the active algorithm';msg.className='';
  syncQiskitHL();
}
// Switch the editor from read-only mirror to an editable custom circuit.
// Run the custom circuit: parse it, load it as the active circuit, and report ok
// or the parse error inline.
/* ════════ UI wiring ════════ */
// Short id lookup used throughout the wiring below.
// Paint a slider's filled portion via the --pct custom property the CSS reads.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}
// Keep target/control qubit selections within the current qubit count and update
// their readouts.
function clampQ(){VS.target=Math.max(0,Math.min(VS.numQubits-1,VS.target));VS.control=Math.max(0,Math.min(VS.numQubits-1,VS.control));$('t-val').textContent=VS.target;$('c-val').textContent=VS.control;$('q-count').textContent=VS.numQubits;}
// Rebuild the sequence list from VS.gates, one row per gate with a delete button.
function renderList(){const list=$('gate-list');list.innerHTML='';if(VS.gates.length===0){list.innerHTML='<div class="gate-empty">pick a preset or build</div>';return;}
  VS.gates.forEach((g,i)=>{const d=document.createElement('div');d.className='gate-item';let q;
    if(g.kind==='measurement')q='all';else if(g.controls&&g.controls.length)q='c'+g.controls[0]+'→t'+g.targets[0];else if(g.name==='swap')q=g.targets[0]+'↔'+g.targets[1];else q='q'+g.targets[0]+(g.params&&g.params.length?' ('+g.params[0].toFixed(2)+')':'');
    d.innerHTML=`<span class="gi-idx">${i}</span><span class="gi-name">${g.kind==='measurement'?'MEAS':g.name.toUpperCase()}</span><span class="gi-q">${q}</span><button class="gi-del" data-i="${i}">✕</button>`;list.appendChild(d);});
  list.querySelectorAll('.gi-del').forEach(b=>b.addEventListener('click',()=>{VS.gates.splice(+b.dataset.i,1);VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));RT.rebuild();}));}
// Append a gate from the palette using the current target/control/angle. Two-qubit
// gates need distinct qubits; a measurement is always removed first so it stays last.
function addGate(name){const two=['cx','cz','swap'].includes(name),rot=['rx','ry','rz'].includes(name);let g;
  if(name==='swap')g={name,kind:'unitary',targets:[VS.target,VS.control],controls:[]};
  else if(two)g={name,kind:'unitary',targets:[VS.target],controls:[VS.control]};
  else if(rot)g={name,kind:'unitary',targets:[VS.target],controls:[],params:[VS.angle]};
  else g={name,kind:'unitary',targets:[VS.target],controls:[]};
  if(two&&VS.target===VS.control){const e=$('c-val');e.style.color='var(--red)';setTimeout(()=>e.style.color='',300);return;}
  VS.gates=VS.gates.filter(x=>x.kind!=='measurement');VS.gates.push(g);VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));RT.rebuild();}
// Qubit-count and target/control steppers; changing the count reloads a preset or
// rebuilds a custom circuit at the new size.
/* ── hover a gate → show its unitary (operator) matrix at the cursor ── */
// Floating tooltip that shows a gate's operator matrix while hovering its button.
const gateTip=document.createElement('div');gateTip.id='gate-tip';document.body.appendChild(gateTip);
// The display matrix (and label/prefactor) for each palette gate.
function gateMatrix(g){switch(g){
  case 'h':return{n:'Hadamard',f:'1/√2',m:[['1','1'],['1','−1']]};
  case 'x':return{n:'Pauli-X (NOT)',m:[['0','1'],['1','0']]};
  case 'y':return{n:'Pauli-Y',m:[['0','−i'],['i','0']]};
  case 'z':return{n:'Pauli-Z',m:[['1','0'],['0','−1']]};
  case 's':return{n:'Phase (S)',m:[['1','0'],['0','i']]};
  case 't':return{n:'T (π/8)',m:[['1','0'],['0','e<sup>iπ/4</sup>']]};
  case 'rx':return{n:'Rx(θ)',p:1,m:[['cos θ⁄2','−i sin θ⁄2'],['−i sin θ⁄2','cos θ⁄2']]};
  case 'ry':return{n:'Ry(θ)',p:1,m:[['cos θ⁄2','−sin θ⁄2'],['sin θ⁄2','cos θ⁄2']]};
  case 'rz':return{n:'Rz(θ)',p:1,m:[['e<sup>−iθ⁄2</sup>','0'],['0','e<sup>iθ⁄2</sup>']]};
  case 'cx':return{n:'CNOT (CX)',two:1,m:[['1','0','0','0'],['0','1','0','0'],['0','0','0','1'],['0','0','1','0']]};
  case 'cz':return{n:'Controlled-Z',two:1,m:[['1','0','0','0'],['0','1','0','0'],['0','0','1','0'],['0','0','0','−1']]};
  case 'swap':return{n:'SWAP',two:1,m:[['1','0','0','0'],['0','0','1','0'],['0','1','0','0'],['0','0','0','1']]};
}return null;}
function showGateTip(g){const d=gateMatrix(g);if(!d){gateTip.style.display='none';return;}
  const cols=d.m[0].length,cells=d.m.flat().map(v=>'<span'+(v==='0'?' class="z"':'')+'>'+v+'</span>').join('');
  let theta='';if(d.p){const r=VS.angle/Math.PI;theta='<div class="tip-theta">θ = '+VS.angle.toFixed(3)+' rad = '+r.toFixed(3)+'π</div>';}
  gateTip.className=d.two?'two':'';
  gateTip.innerHTML='<div class="tip-name">'+d.n+'</div><div class="tip-mtx">'+(d.f?'<span class="tip-fac">'+d.f+'</span>':'')+
    '<div class="brk l"></div><div class="cells" style="grid-template-columns:repeat('+cols+',auto)">'+cells+'</div><div class="brk r"></div></div>'+theta;
  gateTip.style.display='block';}
function moveGateTip(e){const pad=16,w=gateTip.offsetWidth,h=gateTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;
  gateTip.style.left=x+'px';gateTip.style.top=y+'px';}
// Append a measurement over all qubits (only one, always last), or clear the circuit.
// Preset buttons load an algorithm.
// View switch (layer stack vs floor field): reset the instance cache and reframe.
// Coloring mode (|ρ| / Re / phase): reset the cache so cells recolor.
// colormap grid (fluidlab-style swatches)
// Paint each colormap swatch by sampling its ramp across the preview canvas.
function renderCmapPreviews(){document.querySelectorAll('.cmap-btn').forEach(btn=>{const cv=btn.querySelector('canvas');cv.width=120;cv.height=24;const x=cv.getContext('2d');const H=CMAPS[btn.dataset.cmap];for(let px=0;px<120;px++){const t=px/119,s=t*(H.length-1),i=Math.min(Math.floor(s),H.length-2),f=s-i;x.fillStyle='rgb('+((H[i][0]+(H[i+1][0]-H[i][0])*f)|0)+','+((H[i][1]+(H[i+1][1]-H[i][1])*f)|0)+','+((H[i][2]+(H[i+1][2]-H[i][2])*f)|0)+')';x.fillRect(px,0,1,24);}});}
// shape grid: the cell primitive (rounded cube, box, sphere, octahedron) needs a
// mesh rebuild because the geometry changes.
// background swatches
// Transport buttons: play/pause, single step, restart.
// Playback and sampling sliders: each stores its value into VS and updates its readout.
/* ---- tone curve editor (Photoshop-style draggable keys) ---- */
// The small canvas that draws the tone curve and lets the middle key be dragged.
// CVP is the inner padding; cvGX/cvGY map curve coords to canvas pixels.
const curveCv=$('curve-cv'),cux=curveCv.getContext('2d');let curveDrag=-1;const CVP=9;
const cvGX=(x,W)=>CVP+x*(W-2*CVP),cvGY=(y,H)=>H-CVP-y*(H-2*CVP);
// Redraw the curve editor: grid, identity diagonal, the current curve, and keys.
function drawCurveEditor(){
  const dpr=Math.min(devicePixelRatio||1,2),W=curveCv.clientWidth||230,H=curveCv.clientHeight||128;
  if(curveCv.width!==(W*dpr|0)||curveCv.height!==(H*dpr|0)){curveCv.width=W*dpr|0;curveCv.height=H*dpr|0;}
  cux.setTransform(dpr,0,0,dpr,0,0);cux.clearRect(0,0,W,H);
  cux.strokeStyle='rgba(150,200,255,0.07)';cux.lineWidth=1;
  for(let i=0;i<=4;i++){const t=i/4;cux.beginPath();cux.moveTo(cvGX(t,W),cvGY(0,H));cux.lineTo(cvGX(t,W),cvGY(1,H));cux.moveTo(cvGX(0,W),cvGY(t,H));cux.lineTo(cvGX(1,W),cvGY(t,H));cux.stroke();}
  cux.strokeStyle='rgba(150,200,255,0.13)';cux.setLineDash([3,3]);cux.beginPath();cux.moveTo(cvGX(0,W),cvGY(0,H));cux.lineTo(cvGX(1,W),cvGY(1,H));cux.stroke();cux.setLineDash([]);
  const hc=heatColor(0.85),cs='rgb('+(hc[0]|0)+','+(hc[1]|0)+','+(hc[2]|0)+')';
  cux.strokeStyle=cs;cux.lineWidth=2;cux.beginPath();
  for(let i=0;i<=80;i++){const x=i/80,y=curveEval(x);if(i===0)cux.moveTo(cvGX(x,W),cvGY(y,H));else cux.lineTo(cvGX(x,W),cvGY(y,H));}cux.stroke();
  for(let i=0;i<CURVE.pts.length;i++){const a=CURVE.pts[i],X=cvGX(a.x,W),Y=cvGY(a.y,H),mid=(i===1);
    cux.beginPath();cux.arc(X,Y,mid?(curveDrag===1?6:5):3,0,7);cux.fillStyle=mid?'#0a0e16':cs;cux.fill();
    if(mid){cux.lineWidth=2;cux.strokeStyle=curveDrag===1?'#fff':cs;cux.stroke();}}
}
// Convert a pointer event to normalized curve coordinates in [0,1].
function curvePt(e){const r=curveCv.getBoundingClientRect(),W=r.width,H=r.height;
  return {x:Math.min(1,Math.max(0,((e.clientX-r.left)-CVP)/(W-2*CVP))),y:Math.min(1,Math.max(0,1-((e.clientY-r.top)-CVP)/(H-2*CVP)))};}
// Which control point (if any) is near the pointer.
function curveHit(pt){const r=curveCv.getBoundingClientRect(),W=r.width,H=r.height;
  for(let i=0;i<CURVE.pts.length;i++){const dx=(CURVE.pts[i].x-pt.x)*(W-2*CVP),dy=(CURVE.pts[i].y-pt.y)*(H-2*CVP);if(dx*dx+dy*dy<110)return i;}return -1;}
// Rebuild the LUT and invalidate the cell cache so the new curve takes effect.
function curveChanged(){buildCurve();RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];RT.grid2dDirty=true;drawCurveEditor();}
// Move the middle key to the pointer (clamped) and apply the change.
function curveSet(e){const pt=curvePt(e);CURVE.pts[1].x=Math.min(0.98,Math.max(0.02,pt.x));CURVE.pts[1].y=Math.min(1,Math.max(0,pt.y));curveChanged();}
// Scrub slider: map 0..100 to the playhead for the active view, pausing play.
// Scene toggle buttons: each flips one VS flag and syncs its button state.
// Orientation button cycles auto ▶ manual vertical ▶ manual horizontal ▶ auto.

export function initUI(){
document.getElementById('cd-qiskit-btn').onclick=function(){const p=document.getElementById('qiskit-panel');p.hidden=!p.hidden;this.classList.toggle('on',!p.hidden);if(!p.hidden)syncQiskitHL();resize();};
document.getElementById('qiskit-custom').onclick=function(){
  const ta=document.getElementById('qiskit-src');ta.readOnly=false;ta.focus();
  this.hidden=true;document.getElementById('qiskit-run').hidden=false;
  const msg=document.getElementById('qiskit-msg');msg.textContent='editing — write your circuit, then Run';msg.className='';};
(function(){const ta=document.getElementById('qiskit-src');
  ta.addEventListener('input',syncQiskitHL);
  ta.addEventListener('scroll',()=>{const hl=document.getElementById('qiskit-hl');hl.scrollTop=ta.scrollTop;hl.scrollLeft=ta.scrollLeft;});})();
document.getElementById('qiskit-run').onclick=()=>{const msg=document.getElementById('qiskit-msg');try{
  const {n,gates}=parseQiskit(document.getElementById('qiskit-src').value);
  VS.numQubits=n;VS.preset='custom';VS.gates=gates;RT.initBasis=0;clampQ();
  document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));
  RT.rebuild();syncQiskitHL();msg.textContent='✓ '+gates.length+' ops on '+n+' qubits';msg.className='ok';
}catch(e){msg.textContent='✕ '+e;msg.className='err';}};
$('q-minus').onclick=()=>{VS.numQubits=Math.max(1,VS.numQubits-1);RT.initBasis=0;clampQ();if(VS.preset!=='custom')RT.loadPreset(VS.preset);else RT.rebuild();};
$('q-plus').onclick=()=>{VS.numQubits=Math.min(8,VS.numQubits+1);RT.initBasis=0;clampQ();if(VS.preset!=='custom')RT.loadPreset(VS.preset);else RT.rebuild();};
$('t-minus').onclick=()=>{VS.target--;clampQ();};$('t-plus').onclick=()=>{VS.target++;clampQ();};
$('c-minus').onclick=()=>{VS.control--;clampQ();};$('c-plus').onclick=()=>{VS.control++;clampQ();};
$('sl-angle').addEventListener('input',function(){VS.angle=+this.value;sg(this);const f=this.value/Math.PI;$('vl-angle').textContent=Math.abs(f-0.5)<0.02?'π/2':Math.abs(f-1)<0.02?'π':f.toFixed(2)+'π';});sg($('sl-angle'));
document.querySelectorAll('.gate-btn').forEach(b=>b.addEventListener('click',()=>addGate(b.dataset.g)));
document.querySelectorAll('.gate-btn').forEach(b=>{
  b.addEventListener('mouseenter',()=>showGateTip(b.dataset.g));
  b.addEventListener('mousemove',moveGateTip);
  b.addEventListener('mouseleave',()=>{gateTip.style.display='none';});});
$('btn-measure').onclick=()=>{VS.gates=VS.gates.filter(x=>x.kind!=='measurement');VS.gates.push({name:'measure',kind:'measurement',targets:Array.from({length:VS.numQubits},(_,i)=>i)});RT.rebuild();};
$('btn-clear').onclick=()=>{VS.gates=[];VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));RT.rebuild();};
document.querySelectorAll('.preset-btn').forEach(b=>b.addEventListener('click',()=>RT.loadPreset(b.dataset.preset)));
document.querySelectorAll('.dock-view').forEach(b=>b.addEventListener('click',()=>{VS.viewMode=b.dataset.view;stopSampling();document.getElementById('hist-panel').classList.remove('show');RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];document.querySelectorAll('.dock-view').forEach(x=>x.classList.toggle('active',x===b));frameCamera();updateHudStatic();if(typeof updateDiagGuide==='function')updateDiagGuide();hideInitHover();}));
document.querySelectorAll('.mode-grid .mode-btn').forEach(b=>b.addEventListener('click',()=>{VS.colorMode=b.dataset.cm;document.querySelectorAll('.mode-grid .mode-btn').forEach(x=>x.classList.toggle('active',x===b));RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];RT.grid2dDirty=true;updateHudStatic();}));
document.querySelectorAll('.cmap-btn').forEach(b=>b.addEventListener('click',()=>{setActiveHeat(CMAPS[b.dataset.cmap]);document.querySelectorAll('.cmap-btn').forEach(x=>x.classList.toggle('active',x===b));if(RT.edgeLines)RT.edgeLines.material.color.copy(edgeColor3());RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];if(typeof drawCurveEditor==='function')drawCurveEditor();RT.grid2dDirty=true;updateHudStatic();}));
renderCmapPreviews();
document.querySelectorAll('.shape-grid .mode-btn').forEach(b=>b.addEventListener('click',()=>{VS.shape=b.dataset.shape;document.querySelectorAll('.shape-grid .mode-btn').forEach(x=>x.classList.toggle('active',x===b));RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];rebuildMeshes();}));
document.querySelectorAll('.bg-sw').forEach(b=>b.addEventListener('click',()=>setBg(b.dataset.bg)));
$('btn-play').onclick=function(){VS.playing=!VS.playing;if(VS.playing)revealMode();this.textContent=VS.playing?'▐▐ Pause':'▶ Play';this.classList.toggle('active',VS.playing);};
$('btn-step').onclick=()=>{if(!RT.trace)return;revealMode();VS.playing=false;$('btn-play').textContent='▶ Play';$('btn-play').classList.remove('active');
  if(VS.viewMode==='stack'){const ns=currentStageFor(VS.stageTime)+1;VS.stageTime=(ns>=RT.totalLayers?0:ns)*stageDuration();return;}
  const fi=Math.floor(VS.frameIndex),cur=RT.trace.frames[Math.min(fi,RT.trace.frames.length-1)].stepIndex;let j=fi+1;while(j<RT.trace.frames.length&&RT.trace.frames[j].stepIndex===cur)j++;VS.frameIndex=j<RT.trace.frames.length?j:0;};
$('btn-restart').onclick=()=>{VS.frameIndex=0;VS.stageTime=0;RT.builtStage=-1;RT.layerEndArr=[];RT.edgeEndArr=[];};
$('sl-speed').addEventListener('input',function(){VS.speed=+this.value;$('vl-speed').textContent=(+this.value).toFixed(1);sg(this);});sg($('sl-speed'));
$('sl-hold').addEventListener('input',function(){VS.holdTime=+this.value;$('vl-hold').textContent=(+this.value).toFixed(1)+'s';sg(this);});sg($('sl-hold'));
$('sl-thresh').addEventListener('input',function(){VS.threshold=+this.value;$('vl-thresh').textContent=(+this.value).toFixed(2);VS.threshDirty=true;sg(this);});sg($('sl-thresh'));
curveCv.addEventListener('pointerdown',e=>{e.preventDefault();curveDrag=1;curveCv.setPointerCapture(e.pointerId);curveSet(e);});
curveCv.addEventListener('pointermove',e=>{if(curveDrag!==1)return;curveSet(e);});
curveCv.addEventListener('pointerup',e=>{curveDrag=-1;try{curveCv.releasePointerCapture(e.pointerId);}catch(_){}drawCurveEditor();});
$('curve-reset').onclick=()=>{CURVE.pts=[{x:0,y:0},{x:0.5,y:Math.pow(0.5,0.2)},{x:1,y:1}];curveDrag=-1;curveChanged();};
drawCurveEditor();
$('sl-scrub').addEventListener('input',function(){if(RT.trace){const f=+this.value/100;if(VS.viewMode==='stack')VS.stageTime=f*totalStackTime();else VS.frameIndex=f*(RT.trace.frames.length-1);revealMode();VS.playing=false;$('btn-play').textContent='▶ Play';$('btn-play').classList.remove('active');}sg(this);});
$('sl-seed').addEventListener('input',function(){VS.seed=+this.value;$('vl-seed').textContent=this.value;sg(this);RT.rebuild();});sg($('sl-seed'));
$('sl-shots').addEventListener('input',function(){$('vl-shots').textContent=this.value;sg(this);});sg($('sl-shots'));
$('sl-gap').addEventListener('input',function(){$('vl-gap').textContent=(+this.value).toFixed(2)+'s';sg(this);if(RT.sampleAnim)RT.sampleAnim.gap=+this.value;});sg($('sl-gap'));
$('tog-full').onclick=function(){VS.showFull=!VS.showFull;this.classList.toggle('on',VS.showFull);
  if(VS.showFull){VS.stageTime=totalStackTime();VS.playing=false;$('btn-play').textContent='▶ Play';$('btn-play').classList.remove('active');}};
$('tog-rotate').onclick=function(){VS.autoRotate=!VS.autoRotate;controls.autoRotate=VS.autoRotate;this.classList.toggle('on',VS.autoRotate);};
$('tog-floor').onclick=function(){VS.floorGrid=!VS.floorGrid;this.classList.toggle('on',VS.floorGrid);};
$('tog-net').onclick=function(){VS.network=!VS.network;this.classList.toggle('on',VS.network);};
$('tog-labels').onclick=function(){VS.labels=!VS.labels;if(RT.labelGroup)RT.labelGroup.visible=VS.labels;this.classList.toggle('on',VS.labels);};
$('tog-inspect').onclick=function(){VS.stepInspect=!VS.stepInspect;this.classList.toggle('on',VS.stepInspect);if(!VS.stepInspect)document.getElementById('step-inspector').classList.remove('show');};
$('tog-grid2d').onclick=function(){VS.grid2d=!VS.grid2d;this.classList.toggle('on',VS.grid2d);RT.grid2dDirty=true;RT.last2dLayer=-99;if(!VS.grid2d)document.getElementById('grid2d-panel').classList.remove('show');};
$('adv-toggle').onclick=function(){const open=document.getElementById('adv-rows').classList.toggle('open');this.classList.toggle('open',open);};
$('orient-btn').onclick=function(){
  if(VS.autoOrient){VS.autoOrient=false;VS.stackAxis='vertical';}        // auto → manual vertical
  else if(VS.stackAxis==='vertical'){VS.stackAxis='horizontal';}         // vertical → horizontal
  else{VS.autoOrient=true;}                                              // horizontal → back to auto
  if(VS.autoOrient){const g=document.getElementById('gl-host');applyAutoOrient(g.clientWidth||600,g.clientHeight||400);
    this.textContent=VS.stackAxis==='horizontal'?'⬌ Horizontal (auto)':'⬍ Vertical (auto)';}
  else this.textContent=VS.stackAxis==='horizontal'?'⬌ Horizontal stack':'⬍ Vertical stack';
  if(VS.viewMode!=='stack'){VS.viewMode='stack';document.querySelectorAll('.dock-view').forEach(b=>b.classList.toggle('active',b.dataset.view==='stack'));}
  frameCamera();};
}

export { clampQ, renderList, setQiskitFromState };
