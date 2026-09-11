// QAVE hud: the step inspector (drawStepInspector + highlightStepCells), the 2D
// rho grid (draw2DGrid + hover readout), and the per-frame text (updateHud/
// updateHudStatic). initHud wires the 2D-grid hover.
//   grep -n "function updateHud" hud.js   grep -n "function draw2DGrid" hud.js
import * as THREE from 'three';
import { VS, RT, dummy, _col, PITCH, CUBE, LAYER_GAP, cellColor, roundRect } from './core.js';
import { cmapCss, currentCmap, phaseColorArr, C_AMBER, C_CYAN } from './color.js';

/* ════════ HUD ════════ */
// Canvas contexts for the two overlay panels: the step inspector and the 2D grid.
const inspCv=document.getElementById('insp-cv'),ictx=inspCv.getContext('2d');
const g2dCv=document.getElementById('grid2d-cv'),g2ctx=g2dCv.getContext('2d');
function draw2DGrid(si){                                     // flat crossword-style heatmap of the current layer's ρ, updates as it builds
  const panel=document.getElementById('grid2d-panel');
  if(!VS.grid2d||!RT.trace){panel.classList.remove('show');return;}
  panel.classList.add('show');
  const L=Math.max(0,Math.min(RT.totalLayers-1,si+1));
  if(L===RT.last2dLayer&&!RT.grid2dDirty)return;                   // redraw only when the layer (or coloring) changes
  RT.last2dLayer=L;RT.grid2dDirty=false;
  const cells=RT.layerCell[L];if(!cells)return;
  const dpr=Math.min(devicePixelRatio||1,2),SZ=186;
  if(g2dCv.width!==(SZ*dpr|0)){g2dCv.width=SZ*dpr|0;g2dCv.height=SZ*dpr|0;g2dCv.style.width=SZ+'px';g2dCv.style.height=SZ+'px';}
  g2ctx.setTransform(dpr,0,0,dpr,0,0);
  g2ctx.fillStyle='#060910';g2ctx.fillRect(0,0,SZ,SZ);       // backdrop shows between cells → crossword gridlines
  const cell=SZ/RT.DIM,gap=cell>5?1:(cell>2.4?0.5:0);
  for(let r=0;r<RT.DIM;r++)for(let c=0;c<RT.DIM;c++){const k=(r*RT.DIM+c)*3,col=cellColor(cells[k],cells[k+1],cells[k+2]);
    g2ctx.fillStyle='rgb('+(col[0]|0)+','+(col[1]|0)+','+(col[2]|0)+')';
    g2ctx.fillRect(c*cell+gap*0.5,r*cell+gap*0.5,cell-gap,cell-gap);}
  g2ctx.strokeStyle='rgba(255,200,80,0.22)';g2ctx.lineWidth=1;g2ctx.beginPath();g2ctx.moveTo(0,0);g2ctx.lineTo(SZ,SZ);g2ctx.stroke(); // diagonal = populations
  document.getElementById('grid2d-title').innerHTML='ρ · 2D · layer <b>'+L+'</b> · '+RT.DIM+'×'+RT.DIM;
  if(gridHover)renderGridOverlay();
}
/* hover the 2D grid → show how the active layer's gate operates (operator support + cell readout) */
// Overlay canvas + floating tooltip for hovering the 2D grid.
const g2ov=document.getElementById('grid2d-ov'),g2octx=g2ov.getContext('2d');
const gridTip=document.createElement('div');gridTip.id='grid-tip';document.body.appendChild(gridTip);
let gridHover=null;const G2SZ=186;
// Binary ket string for a basis index at the current qubit count.
function bitstr(v){return v.toString(2).padStart(VS.numQubits,'0');}
// All subsets of a bit mask (used to enumerate the cells a gate couples).
function gateSubmasks(mask){const s=[];let x=mask;for(;;x=(x-1)&mask){s.push(x);if(x===0)break;}return s;}
// Draw the hover overlay: shade the cells the active gate touches and outline the
// hovered cell.
function renderGridOverlay(){
  const dpr=Math.min(devicePixelRatio||1,2);
  if(g2ov.width!==(G2SZ*dpr|0)){g2ov.width=G2SZ*dpr|0;g2ov.height=G2SZ*dpr|0;g2ov.style.width=G2SZ+'px';g2ov.style.height=G2SZ+'px';}
  g2octx.setTransform(dpr,0,0,dpr,0,0);g2octx.clearRect(0,0,G2SZ,G2SZ);
  if(gridHover&&(gridHover.r>=RT.DIM||gridHover.c>=RT.DIM))gridHover=null;
  if(!gridHover||!RT.trace)return;
  const L=RT.last2dLayer,g=(L>=1&&RT.trace.steps[L-1])?RT.trace.steps[L-1]:null,cell=G2SZ/RT.DIM;
  if(g&&g.kind!=='measurement'){const Q=(g.targets||[]).concat(g.controls||[]);
    if(Q.length<=2){let mask=0;for(const q of Q)mask|=(1<<q);
      const col=(g.controls&&g.controls.length)?C_AMBER:C_CYAN;g2octx.fillStyle='rgba('+col[0]+','+col[1]+','+col[2]+',0.30)';
      const subs=gateSubmasks(mask);for(let i=0;i<RT.DIM;i++)for(const s of subs){const j=i^s;g2octx.fillRect(j*cell,i*cell,Math.max(1,cell),Math.max(1,cell));}}}
  g2octx.strokeStyle='#fff';g2octx.lineWidth=1.5;g2octx.strokeRect(gridHover.c*cell,gridHover.r*cell,Math.max(2,cell),Math.max(2,cell));
}
// Map a mouse event over the 2D grid to a (row, col) cell, or null if outside.
function gridCellFromEvent(e){const r=g2dCv.getBoundingClientRect(),cell=G2SZ/RT.DIM;
  const c=Math.floor((e.clientX-r.left)/cell),rr=Math.floor((e.clientY-r.top)/cell);
  if(c<0||rr<0||c>=RT.DIM||rr>=RT.DIM)return null;return {r:rr,c};}
// Tooltip for a hovered ρ cell: name the gate and cell ⟨r|ρ|c⟩, show |ρ| and its
// phase, and say whether the active gate couples this cell.
function showGridTip(e){const hc=gridCellFromEvent(e);if(!hc||!RT.trace){hideGridTip();return;}
  gridHover=hc;renderGridOverlay();
  const L=RT.last2dLayer,g=(L>=1&&RT.trace.steps[L-1])?RT.trace.steps[L-1]:null,cells=RT.layerCell[L];
  const k=(hc.r*RT.DIM+hc.c)*3,mag=cells?cells[k]:0,re=cells?cells[k+1]:0,im=cells?cells[k+2]:0,ph=Math.round(Math.atan2(im,re)*180/Math.PI);
  let gate,note,two=false;
  if(!g){gate='initial state';note='no gate at layer 0 — pure |0…0⟩';}
  else{two=!!(g.controls&&g.controls.length);let q;
    if(g.kind==='measurement')q='all';else if(two)q='ctrl q'+g.controls.join(',')+' → q'+g.targets[0];else if(g.name==='swap')q='q'+g.targets[0]+' ↔ q'+g.targets[1];else q='q'+g.targets[0];
    gate=(g.kind==='measurement'?'MEASURE':g.name.toUpperCase())+' · '+q;
    const Q=(g.targets||[]).concat(g.controls||[]);let mask=0;for(const x of Q)mask|=(1<<x);
    const inSup=g.kind!=='measurement'&&Q.length<=2&&(((hc.r^hc.c)&~mask)===0);
    note=g.kind==='measurement'?'measurement keeps only the diagonal':(inSup?'★ this cell is coupled by the gate':'untouched by this gate (spectator qubits differ)');}
  gridTip.className=two?'two':'';
  gridTip.innerHTML='<div class="gt-gate">'+gate+'</div><div class="gt-cell">⟨'+bitstr(hc.r)+'|ρ|'+bitstr(hc.c)+'⟩</div>'+
    '<div class="gt-val">|ρ| = '+mag.toFixed(3)+(mag>0.004?'  ∠ '+ph+'°':'')+'</div><div class="gt-note">'+note+'</div>';
  gridTip.style.display='block';
  const pad=15,w=gridTip.offsetWidth,h=gridTip.offsetHeight;let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;gridTip.style.left=x+'px';gridTip.style.top=y+'px';
}
function hideGridTip(){gridHover=null;gridTip.style.display='none';renderGridOverlay();}
// Draw the step inspector panel and, in stack view, highlight the coupled cells.
function drawStepInspector(si){                              // mini score-column of the active step: gate glyph + highlighted qubits
  const panel=document.getElementById('step-inspector');
  if(!VS.stepInspect||!RT.trace){panel.classList.remove('show');if(RT.inspMesh)RT.inspMesh.count=0;RT.lastInspStep=-99;return;}
  panel.classList.add('show');
  const N=VS.numQubits,g=(si>=0&&si<VS.gates.length)?VS.gates[si]:null;
  const dpr=Math.min(devicePixelRatio||1,2),LW=24,GW=60,laneH=17,padT=9,Wc=LW+GW,Hc=padT*2+Math.max(1,N)*laneH;
  if(inspCv.width!==(Wc*dpr|0)||inspCv.height!==(Hc*dpr|0)){inspCv.width=Wc*dpr|0;inspCv.height=Hc*dpr|0;inspCv.style.width=Wc+'px';inspCv.style.height=Hc+'px';}
  ictx.setTransform(dpr,0,0,dpr,0,0);ictx.clearRect(0,0,Wc,Hc);
  const lY=q=>padT+(N-1-q)*laneH+laneH/2,gx=LW+GW/2;        // q0 at the bottom
  const acted=g?new Set((g.targets||[]).concat(g.controls||[])):new Set();
  ictx.textBaseline='middle';ictx.font='600 9px JetBrains Mono,monospace';
  for(let q=0;q<N;q++){const y=lY(q),hot=acted.has(q);
    ictx.strokeStyle=hot?'rgba(255,200,80,0.55)':'rgba(70,95,135,0.5)';ictx.lineWidth=1;ictx.beginPath();ictx.moveTo(LW,y);ictx.lineTo(Wc-4,y);ictx.stroke();
    ictx.fillStyle=hot?'#ffc850':'#7f90ad';ictx.textAlign='left';ictx.fillText('q'+q,3,y);}
  if(g){const col=(g.kind==='measurement')?[182,196,216]:((g.controls&&g.controls.length)?C_AMBER:C_CYAN),cs='rgb('+col[0]+','+col[1]+','+col[2]+')';
    if(g.controls&&g.controls.length){const ys=g.controls.concat(g.targets).map(lY),y0=Math.min(...ys),y1=Math.max(...ys);
      ictx.strokeStyle=cs;ictx.lineWidth=2;ictx.beginPath();ictx.moveTo(gx,y0);ictx.lineTo(gx,y1);ictx.stroke();
      for(const cq of g.controls){ictx.fillStyle=cs;ictx.beginPath();ictx.arc(gx,lY(cq),3.6,0,7);ictx.fill();}}
    const bw=27,bh=14;
    for(const q of g.targets){const y=lY(q);
      ictx.fillStyle='rgba(8,12,20,0.96)';roundRect(ictx,gx-bw/2,y-bh/2,bw,bh,4);ictx.fill();
      ictx.strokeStyle=cs;ictx.lineWidth=2;roundRect(ictx,gx-bw/2,y-bh/2,bw,bh,4);ictx.stroke();
      ictx.fillStyle=cs;ictx.font='700 10px JetBrains Mono,monospace';ictx.textAlign='center';
      ictx.fillText(g.kind==='measurement'?'M':(g.name==='swap'?'×':g.name.toUpperCase().slice(0,3)),gx,y+0.5);}}
  let lbl,note='';
  if(!g){lbl='<b>initial</b> state |0…0⟩';note='no gate applied yet';}
  else{let q;if(g.kind==='measurement')q='all qubits';else if(g.controls&&g.controls.length)q='ctrl q'+g.controls.join(',')+' → q'+g.targets[0];
    else if(g.name==='swap')q='q'+g.targets[0]+' ↔ q'+g.targets[1];else q='q'+g.targets[0]+(g.params&&g.params.length?' · θ='+g.params[0].toFixed(2):'');
    lbl='step <b>'+(si+1)+'</b>/'+VS.gates.length+' · '+(g.kind==='measurement'?'MEASURE':g.name.toUpperCase())+' · '+q;
    if(g.kind==='measurement')note='collapses all qubits onto a basis state';
    else if(g.name==='swap')note='exchanges q'+g.targets[0]+' ↔ q'+g.targets[1]+' — lit cells are coupled';
    else if(g.controls&&g.controls.length)note='acts on q'+g.targets[0]+' only where q'+g.controls.join(',')+'=1 — lit block is its reach';
    else note='mixes states differing in q'+g.targets[0]+' — diagonal + cross-stripes lit';}
  document.getElementById('insp-title').innerHTML=lbl+'<span class="note">'+note+'</span>';
  highlightStepCells(si,g);
}
// Place additive highlight cubes on exactly the cells (i,j) the active gate can
// couple: those agreeing on every spectator qubit, i.e. (i^j) has no bits outside
// the gate's qubit mask. Diagonals glow brighter than off-diagonals.
function highlightStepCells(si,g){                          // tint the array cells this gate's operator couples (diagonal + cross-correlation off-diagonals)
  if(!RT.inspMesh)return;
  const Q=g?(g.targets||[]).concat(g.controls||[]):[],k=Q.length;
  if(!g||g.kind==='measurement'||k>2||VS.viewMode!=='stack'){RT.inspMesh.count=0;RT.lastInspStep=-99;return;}
  if(si===RT.lastInspStep)return;                              // already placed for this step
  RT.lastInspStep=si;
  let mask=0;for(const q of Q)mask|=(1<<q);
  const L=Math.min(RT.totalLayers-1,si+1),baseY=L*LAYER_GAP+CUBE/2,off=(RT.DIM-1)/2;
  const col=(g.controls&&g.controls.length)?C_AMBER:C_CYAN,cap=RT.inspMesh.instanceMatrix.count;
  let n=0;
  for(let i=0;i<RT.DIM&&n<cap;i++)for(let j=0;j<RT.DIM&&n<cap;j++){
    if(((i^j)&~mask)===0){                                  // i and j agree on every spectator qubit → operator can touch (i,j)
      dummy.position.set((j-off)*PITCH,baseY,(i-off)*PITCH);dummy.scale.set(1,1,1);dummy.updateMatrix();RT.inspMesh.setMatrixAt(n,dummy.matrix);
      const b=(i===j)?1.05:0.62;_col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b,THREE.SRGBColorSpace);RT.inspMesh.setColorAt(n,_col);n++;}
  }
  RT.inspMesh.count=n;RT.inspMesh.instanceMatrix.needsUpdate=true;if(RT.inspMesh.instanceColor)RT.inspMesh.instanceColor.needsUpdate=true;
}
// Update the parts of the HUD that change only on a rebuild: qubit count and the
// color legend for the active coloring mode.
function updateHudStatic(){document.getElementById('st-qubits').textContent=VS.numQubits+' qubits';
  const lg=document.getElementById('legend');
  if(VS.colorMode==='mag')lg.innerHTML='<span><i style="background:'+cmapCss(currentCmap())+'"></i>|ρ| low→high</span>';
  else if(VS.colorMode==='real')lg.innerHTML='<span><i style="background:linear-gradient(90deg,#ffb948,#24344e,#45d3ff)"></i>Re(ρ) −→+</span>';
  else lg.innerHTML='<span><i style="background:linear-gradient(90deg,#4bd7ff,#8273ff,#ffb15c)"></i>∠ρ phase</span>';}
// Per-frame HUD: refresh the inspector and 2D grid, then rewrite the step/phase,
// outcome, and telemetry readouts for the current frame.
function updateHud(frame){const steps=VS.gates.length,si=frame?frame.stepIndex:0;
  drawStepInspector(si);draw2DGrid(si);
  const ph=frame?frame.phase:'—';const c=phaseColorArr(ph);
  document.getElementById('hud-step').innerHTML='step '+(si<0?0:si+1)+'/'+steps+' · phase <b style="color:rgb('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+')">'+ph+'</b>'+(VS.viewMode==='stack'?' · layer '+(Math.max(0,si+1))+'/'+(RT.totalLayers-1):'');
  document.getElementById('st-step').innerHTML='step <b>'+(si<0?0:si+1)+'</b>/'+steps;
  let outcome='—';if(RT.trace){const ms=RT.trace.steps.find(s=>s.selectedOutcome!=null);if(ms)outcome=ms.selectedOutcome;}
  document.getElementById('st-outcome').innerHTML='outcome <b>'+(outcome==='—'?'—':'|'+outcome+'⟩')+'</b>';
  const gname=frame&&frame.gateName!=='init'?frame.gateName.toUpperCase():'—';
  document.getElementById('hud-tr').innerHTML='STATE: <b>op_'+(si<0?0:si)+'_'+gname.toLowerCase()+'</b><br>BLOCK: <b>['+Array.from({length:VS.numQubits},(_,i)=>i).join(',')+']</b><br>MODE: <b>'+(VS.viewMode==='stack'?'layer stack · full history':'floor field')+'</b><br>LAYERS: <b>'+(Math.max(0,si+1)+1)+'/'+RT.totalLayers+'</b><br>GATE: <span class="hi">'+gname+'</span><br>OUTCOME: <span class="hi">'+(outcome==='—'?'pending':'|'+outcome+'⟩')+'</span>';
  const b=document.getElementById('hud-bottom');
  if(frame&&frame.measurement)b.innerHTML='<span class="tag">shot_stack:</span> collapsed outcome |'+(outcome==='—'?'?':outcome)+'⟩ is the bright cube; lines trace from the responsible diagonal source cells in the layer below.';
  else if(VS.viewMode==='stack')b.innerHTML='<span class="tag">layer stack:</span> each slab is ρ = |ψ⟩⟨ψ| after one computation step; the circuit builds upward, one layer per gate. color = |ρ<sub>ij</sub>| heatmap.';
  else b.innerHTML='<span class="tag">floor field:</span> single ρ(t) grid morphing on the animated floor. height ∝ |ρ<sub>ij</sub>|.';}

export function initHud(){
g2dCv.addEventListener('mousemove',showGridTip);
g2dCv.addEventListener('mouseleave',hideGridTip);
}

export { updateHud, updateHudStatic };
