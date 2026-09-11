// QAVE lens: the circuit "score" canvas (drawLens + pointer scrub + playhead
// follow) and the RZ angle editor (openAngleEditor/setAngle). initLens wires the
// score pointer, keyboard transport, and outside-press handlers.
//   grep -n "function drawLens" lens.js   grep -n "function setAngle" lens.js
import { VS, RT, roundRect, currentStageFor, stageDuration } from './core.js';
import { phaseColorArr, C_AMBER, C_CYAN } from './color.js';

/* ════════ circuit lens ════════ */
// The circuit "score": a 2D canvas drawing qubit wires as staff lines and gates as
// notes, with a playhead, bar lines every 4 columns, and a pinned qubit-label gutter.
const circ=document.getElementById('circuit-canvas'),cctx=circ.getContext('2d');
const cgut=document.getElementById('cgutter'),gctx=cgut.getContext('2d');
const cscroll=document.getElementById('circuit-scroll');
const COLW=46,GUT=30,PADR=20;                              // fixed column pitch → no squeeze; long circuits scroll like a score
let circLayout={colW:COLW,x0:GUT+6,steps:0};
// Vertical center of qubit q's staff line.
function laneY(q,padT,laneH){return padT+laneH*(q+0.5);}
// Rounded-rectangle path helper for the gate note boxes.
// Redraw the whole score for the given frame: size the canvas (growing to scroll
// for long circuits), draw bar lines, the playhead, the wires, each gate note,
// the layer numbers, and the sticky gutter labels.
function drawLens(frame){
  const dpr=Math.min(devicePixelRatio||1,2);
  const N=VS.numQubits,steps=VS.gates.length;
  const Hcss=circ.clientHeight||128,viewW=cscroll.clientWidth||700;
  const x0=GUT+8;
  const Wcss=Math.max(viewW,x0+steps*COLW+PADR);           // fill the view, or grow & scroll
  if(circ.style.width!==Wcss+'px')circ.style.width=Wcss+'px';
  if(circ.width!==Math.round(Wcss*dpr)||circ.height!==Math.round(Hcss*dpr)){circ.width=Math.round(Wcss*dpr);circ.height=Math.round(Hcss*dpr);}
  cctx.setTransform(dpr,0,0,dpr,0,0);cctx.clearRect(0,0,Wcss,Hcss);
  const padT=15,padB=Hcss-18,laneH=(padB-padT)/Math.max(1,N);
  circLayout={colW:COLW,x0,steps,padT,laneH,bw:Math.min(28,COLW*0.62),bh:Math.min(19,laneH*0.8)};
  const cur=frame?frame.stepIndex:-1,colX=s=>x0+COLW*(s+0.5),endX=x0+COLW*steps;
  // measure/bar lines every 4 columns (score "bars" — help read large circuits)
  cctx.strokeStyle='rgba(70,95,135,0.16)';cctx.lineWidth=1;
  for(let s=0;s<=steps;s+=4){const bx=x0+COLW*s;cctx.beginPath();cctx.moveTo(bx,padT-7);cctx.lineTo(bx,padB+7);cctx.stroke();}
  // playhead cursor (current layer)
  if(cur>=0){const px=x0+COLW*cur;cctx.fillStyle='rgba(255,200,80,0.11)';cctx.fillRect(px,padT-8,COLW,padB-padT+16);
    cctx.strokeStyle='rgba(255,200,80,0.85)';cctx.lineWidth=1.5;const mx=px+COLW/2;cctx.beginPath();cctx.moveTo(mx,padT-9);cctx.lineTo(mx,padB+9);cctx.stroke();
    cctx.fillStyle='rgba(255,200,80,0.95)';cctx.beginPath();cctx.moveTo(mx-4,padT-9);cctx.lineTo(mx+4,padT-9);cctx.lineTo(mx,padT-4);cctx.fill();}
  // staff lines (qubit wires)
  for(let q=0;q<N;q++){const y=laneY(q,padT,laneH);cctx.strokeStyle='rgba(70,95,135,0.55)';cctx.lineWidth=1;cctx.beginPath();cctx.moveTo(x0-8,y);cctx.lineTo(endX+10,y);cctx.stroke();}
  // gates as score notes
  cctx.textBaseline='middle';
  for(let s=0;s<steps;s++){const g=VS.gates[s],x=colX(s),active=s===cur;
    const col=active&&frame?phaseColorArr(frame.phase):(g.kind==='measurement'?[182,196,216]:(g.controls&&g.controls.length?C_AMBER:C_CYAN));
    const cs='rgb('+(col[0]|0)+','+(col[1]|0)+','+(col[2]|0)+')';
    if(g.controls&&g.controls.length){const ys=g.controls.concat(g.targets).map(q=>laneY(q,padT,laneH));const y0=Math.min(...ys),y1=Math.max(...ys);
      cctx.strokeStyle=cs;cctx.lineWidth=active?2:1.4;cctx.beginPath();cctx.moveTo(x,y0);cctx.lineTo(x,y1);cctx.stroke();
      for(const cq of g.controls){const cy=laneY(cq,padT,laneH);cctx.fillStyle=cs;cctx.beginPath();cctx.arc(x,cy,3.4,0,7);cctx.fill();}}
    const bw=Math.min(28,COLW*0.62),bh=Math.min(19,laneH*0.8);
    for(const q of g.targets){const gy=laneY(q,padT,laneH);
      cctx.fillStyle='rgba(8,12,20,0.96)';roundRect(cctx,x-bw/2,gy-bh/2,bw,bh,4);cctx.fill();
      cctx.strokeStyle=cs;cctx.lineWidth=active?2:1.3;roundRect(cctx,x-bw/2,gy-bh/2,bw,bh,4);cctx.stroke();
      cctx.fillStyle=active?cs:'#cdd6e6';cctx.font='700 10px JetBrains Mono,monospace';cctx.textAlign='center';
      cctx.fillText(g.kind==='measurement'?'M':(g.name==='swap'?'×':g.name.toUpperCase()).slice(0,3),x,gy+0.5);
      if(g.name==='rz'&&g.params){cctx.font='600 7px JetBrains Mono,monospace';cctx.fillStyle=(s===editSel)?'#ffb948':'rgba(150,200,255,0.62)';cctx.fillText(fmtPi(g.params[0]),x,gy-bh/2-6);}
    }}
  // layer numbers (beats) under each column
  cctx.textAlign='center';cctx.textBaseline='top';cctx.font='500 8px JetBrains Mono,monospace';
  cctx.fillStyle=(cur<0)?'rgba(255,200,80,0.95)':'rgba(110,125,150,0.65)';cctx.fillText('L0',x0-4,padB+5);
  for(let s=0;s<steps;s++){cctx.fillStyle=(s===cur)?'rgba(255,200,80,0.95)':'rgba(110,125,150,0.65)';cctx.fillText('L'+(s+1),colX(s),padB+5);}
  // sticky qubit-label gutter (stays pinned while the score scrolls)
  if(cgut.width!==Math.round(GUT*dpr)||cgut.height!==Math.round(Hcss*dpr)){cgut.width=Math.round(GUT*dpr);cgut.height=Math.round(Hcss*dpr);}
  gctx.setTransform(dpr,0,0,dpr,0,0);gctx.clearRect(0,0,GUT,Hcss);
  const grd=gctx.createLinearGradient(0,0,GUT,0);grd.addColorStop(0,'rgba(11,16,28,0.98)');grd.addColorStop(0.65,'rgba(11,16,28,0.95)');grd.addColorStop(1,'rgba(11,16,28,0)');
  gctx.fillStyle=grd;gctx.fillRect(0,0,GUT,Hcss);gctx.textAlign='left';gctx.textBaseline='middle';gctx.font='600 10px JetBrains Mono,monospace';gctx.fillStyle='#8fa0bd';
  for(let q=0;q<N;q++)gctx.fillText('q'+q,5,laneY(q,padT,laneH));
}
/* ── scrub by dragging on the score (== moving the Scrub slider) ── */
function revealMode(){VS.showFull=false;const t=document.getElementById('tog-full');if(t)t.classList.remove('on');} // scrub/play/step drop "show all" so layers reveal one at a time
// Map a pointer x on the score to a layer and move the playhead there, pausing play.
function circuitScrubTo(clientX){if(!RT.trace)return;const rect=circ.getBoundingClientRect();const x=clientX-rect.left;
  const {colW,x0,steps}=circLayout;if(steps<1)return;let s=Math.floor((x-x0)/colW);s=Math.max(0,Math.min(steps-1,s));
  if(VS.viewMode==='stack')VS.stageTime=(s+1)*stageDuration()+1e-3;else VS.frameIndex=((s+0.5)/steps)*(RT.trace.frames.length-1);
  revealMode();VS.playing=false;const pb=document.getElementById('btn-play');if(pb){pb.textContent='▶ Play';pb.classList.remove('active');}}
// Score pointer wiring: clicking an RZ note opens its angle editor; otherwise a
// press-drag scrubs the playhead. Move sets the cursor and drives scrubbing.
let scrubbing=false;

/* ════════ RZ angle editor — click an RZ note on the score to retune its phase ════════ */
// editSel: index of the RZ gate being edited; rzEd: the lazily-built popup element.
let editSel=-1, rzEd=null;
// Format an angle as a fraction of π when it is close to a common value, else radians.
function fmtPi(v){
  const r=v/Math.PI, near=(a,b)=>Math.abs(a-b)<0.012, sgn=r<0?'−':'';
  const fr=[[0,'0'],[1/16,'π/16'],[1/8,'π/8'],[1/6,'π/6'],[1/4,'π/4'],[1/3,'π/3'],[1/2,'π/2'],[3/4,'3π/4'],[1,'π'],[3/2,'3π/2'],[2,'2π']];
  for(const [k,s] of fr){if(near(Math.abs(r),k))return k===0?'0':sgn+s;}
  return v.toFixed(3);
}
// Hit-test the score: return the index of an RZ gate note under the pointer, or -1.
function rzGateAt(clientX,clientY){
  if(!VS.gates.length||!circLayout||circLayout.padT==null)return -1;
  const rect=circ.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
  const {x0,colW,padT,laneH,bw,bh}=circLayout;
  for(let s=0;s<VS.gates.length;s++){const g=VS.gates[s];
    if(g.name!=='rz'||!g.params)continue;
    const gx=x0+colW*(s+0.5),gy=laneY(g.targets[0],padT,laneH);
    if(Math.abs(x-gx)<=bw/2+3&&Math.abs(y-gy)<=bh/2+3)return s;}
  return -1;
}
// Build the RZ editor popup once (slider, +/- steps, number field) and wire each
// control to setAngle so retuning is live.
function buildRzEditor(){
  rzEd=document.createElement('div');rzEd.id='rz-editor';
  rzEd.style.cssText='position:fixed;z-index:500;display:none;width:218px;background:rgba(9,12,20,0.98);'
    +'border:1px solid var(--border-b);border-radius:9px;padding:11px 12px 12px;backdrop-filter:blur(9px);'
    +"box-shadow:0 8px 30px rgba(0,0,0,0.6);font-family:'JetBrains Mono',monospace;user-select:none";
  rzEd.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">'
      +'<span id="rz-title" style="font-size:0.64rem;letter-spacing:0.12em;color:#ffb948;font-weight:600"></span>'
      +'<span id="rz-x" style="cursor:pointer;color:#7d8aa0;font-size:0.7rem;padding:0 2px">✕</span></div>'
    +'<div style="font-size:0.7rem;color:#cdd6e6;margin-bottom:8px"><span id="rz-rad"></span> rad <span style="color:#5a8cc0">·</span> <span id="rz-frac" style="color:#96c8ff"></span></div>'
    +'<input type="range" id="rz-slider" min="-6.2832" max="6.2832" step="0.01" style="width:100%;accent-color:#ffb948;margin-bottom:9px">'
    +'<div style="display:flex;gap:4px;align-items:center">'
      +'<button class="rz-step" data-d="-0.7853981">−π/4</button>'
      +'<button class="rz-step" data-d="-0.0314159">−</button>'
      +'<input type="number" id="rz-num" step="0.01" style="flex:1;min-width:0;background:rgba(20,28,42,0.9);border:1px solid var(--border-b);color:#cdd6e6;font-family:inherit;font-size:0.66rem;padding:4px 5px;border-radius:4px;text-align:center">'
      +'<button class="rz-step" data-d="0.0314159">+</button>'
      +'<button class="rz-step" data-d="0.7853981">+π/4</button></div>'
    +'<div style="font-size:0.55rem;color:#5a8cc0;margin-top:8px;line-height:1.4">live · retunes the encoded phase and recomputes the state</div>';
  document.body.appendChild(rzEd);
  rzEd.querySelectorAll('.rz-step').forEach(b=>{
    b.style.cssText='background:transparent;border:1px solid var(--border-b);color:#96c8ff;font-family:inherit;'
      +'font-size:0.6rem;padding:5px 4px;border-radius:4px;cursor:pointer;white-space:nowrap';
    b.addEventListener('click',()=>{if(editSel<0)return;setAngle(VS.gates[editSel].params[0]+parseFloat(b.dataset.d));});});
  rzEd.querySelector('#rz-slider').addEventListener('input',e=>setAngle(parseFloat(e.target.value)));
  rzEd.querySelector('#rz-num').addEventListener('input',e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setAngle(v);});
  rzEd.querySelector('#rz-x').addEventListener('click',closeAngleEditor);
  return rzEd;
}
// Reflect the edited gate's current angle into the popup's widgets.
function syncRzEditor(){
  if(editSel<0||!rzEd)return;const v=VS.gates[editSel].params[0];
  rzEd.querySelector('#rz-rad').textContent=v.toFixed(3);
  rzEd.querySelector('#rz-frac').textContent=fmtPi(v);
  const sl=rzEd.querySelector('#rz-slider');if(document.activeElement!==sl)sl.value=v;
  const nm=rzEd.querySelector('#rz-num');if(document.activeElement!==nm)nm.value=v.toFixed(3);
}
// Apply a new angle to the edited gate: mark the circuit custom, pause, and
// rebuild the trace (keeping the playhead) so the change shows immediately.
function setAngle(v){
  if(editSel<0)return;
  VS.gates[editSel].params[0]=v;
  VS.preset='custom';document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));
  VS.playing=false;const pb=document.getElementById('btn-play');if(pb){pb.textContent='▶ Play';pb.classList.remove('active');}
  RT.rebuild(true);syncRzEditor();
}
// Open the editor for gate s near the pointer, clamped to stay on screen.
function openAngleEditor(s,clientX,clientY){
  editSel=s;const g=VS.gates[s];if(!rzEd)buildRzEditor();
  rzEd.querySelector('#rz-title').textContent='RZ · q'+g.targets[0]+' · L'+(s+1);
  rzEd.style.display='block';syncRzEditor();
  const w=rzEd.offsetWidth,h=rzEd.offsetHeight,pad=14;
  let x=clientX+pad,y=clientY-h-pad;
  if(x+w>innerWidth-8)x=clientX-pad-w;if(x<8)x=8;
  if(y<8)y=clientY+pad;if(y+h>innerHeight-8)y=innerHeight-8-h;
  rzEd.style.left=x+'px';rzEd.style.top=y+'px';
}
// Close the RZ editor.
function closeAngleEditor(){editSel=-1;if(rzEd)rzEd.style.display='none';}
// Advance or rewind by one layer (stack) or one gate's worth of frames (floor).
function stepLayer(dir){
  if(!RT.trace)return;revealMode();VS.playing=false;
  const pb=document.getElementById('btn-play');if(pb){pb.textContent='▶ Play';pb.classList.remove('active');}
  if(VS.viewMode==='stack'){
    let s=Math.max(0,Math.min(RT.totalLayers-1,currentStageFor(VS.stageTime)+dir));
    VS.stageTime=s*stageDuration()+1e-3;return;}
  const fi=Math.floor(VS.frameIndex),cur=RT.trace.frames[Math.min(fi,RT.trace.frames.length-1)].stepIndex;
  if(dir>0){let j=fi+1;while(j<RT.trace.frames.length&&RT.trace.frames[j].stepIndex===cur)j++;VS.frameIndex=Math.min(j,RT.trace.frames.length-1);}
  else{let j=fi;while(j>0&&RT.trace.frames[j].stepIndex===cur)j--;const pst=RT.trace.frames[j].stepIndex;while(j>0&&RT.trace.frames[j-1].stepIndex===pst)j--;VS.frameIndex=Math.max(0,j);}
}
// Keep the playhead in view: nudge the score's horizontal scroll to track it,
// snapping while scrubbing and easing while playing.
function followPlayhead(){if(!RT.trace)return;const {colW,x0,steps}=circLayout;if(steps<1)return;
  let s=VS.viewMode==='stack'?Math.max(0,currentStageFor(VS.stageTime)-1):Math.floor((VS.frameIndex/Math.max(1,RT.trace.frames.length-1))*steps);
  const cx=x0+colW*(s+0.5),vw=cscroll.clientWidth,left=cscroll.scrollLeft;
  if(scrubbing){if(cx<left+colW*1.2)cscroll.scrollLeft=Math.max(0,cx-colW*1.8);else if(cx>left+vw-colW*1.2)cscroll.scrollLeft=cx-vw+colW*1.8;}
  else if(VS.playing){cscroll.scrollLeft+=((cx-vw/2)-left)*0.12;}}


export function initLens(){
circ.addEventListener('pointerdown',e=>{
  const rs=rzGateAt(e.clientX,e.clientY);
  if(rs>=0){openAngleEditor(rs,e.clientX,e.clientY);e.preventDefault();return;}
  closeAngleEditor();
  scrubbing=true;try{circ.setPointerCapture(e.pointerId);}catch(_){}circuitScrubTo(e.clientX);e.preventDefault();});
circ.addEventListener('pointermove',e=>{
  if(scrubbing){circuitScrubTo(e.clientX);e.preventDefault();return;}
  circ.style.cursor=rzGateAt(e.clientX,e.clientY)>=0?'pointer':'ew-resize';});
// Close it on any outside press (capture phase so it beats other handlers).
document.addEventListener('pointerdown',e=>{
  if(editSel<0)return;
  if(rzEd&&rzEd.contains(e.target))return;
  if(e.target===circ)return;
  closeAngleEditor();},true);
// Keyboard transport: arrows step, Escape closes the editor; ignored in inputs.
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeAngleEditor();return;}
  const t=e.target,tn=t&&t.tagName;
  if(tn==='INPUT'||tn==='TEXTAREA'||tn==='SELECT'||(t&&t.isContentEditable))return;
  if(e.key==='ArrowRight'){stepLayer(1);e.preventDefault();}
  else if(e.key==='ArrowLeft'){stepLayer(-1);e.preventDefault();}
});
circ.addEventListener('pointerup',()=>{scrubbing=false;});
circ.addEventListener('pointercancel',()=>{scrubbing=false;});
}

export { drawLens, followPlayhead, revealMode };
