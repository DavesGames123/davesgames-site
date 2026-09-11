/* ════════════════════════════════════════════════════════════
   UI — quick panel + advanced panel DOM wiring
   Module-level helpers other subsystems call (updateInfoBar,
   applyQN, setN, setColorMode, setAnimate, setMagField, syncQN,
   updateDisplay) plus initUI(), which registers every DOM listener
   and runs the initial setters. Inline-onclick targets stay reachable
   through the window.* assignments below.
   GREP: updateDisplay | updateInfoBar | applyQN | syncQN | setN
         setColorMode | setAnimate | setMagField | initUI
   ════════════════════════════════════════════════════════════ */
import { S, RT, camera, renderer } from './core.js';
import { pMat, startGrow, rebuildStaticFlow, axesHelper } from './particles.js';
import { computeBField, uploadBArrows, bArrowShaft } from './bfield.js';
import { ftLines, btLines } from './tracers.js';
import { ARP } from './arpanel.js';

/* ════════════════════════════════════════════════════════════
   UI WIRING — Quick Panel + Advanced Panel
   GREP: updateDisplay | syncQN | applyQN | setN | setColorMode
         setAnimate | setMagField | toggleAdv | toggleQPCollapse
   ════════════════════════════════════════════════════════════ */
const SUBSHELLS=['s','p','d','f','g','h'];

/* ── Display helpers ── */
// Repaint every place the current n / ℓ / m and subshell name appear: the state
// ket, the quick panel, and the (hidden) advanced-panel readouts.
export function updateDisplay(){
  const{n,l,m}=S; const ms=(m>=0?'+':'')+m;
  // State display (top-right ket)
  document.getElementById('ket-disp').textContent=`|${n},${l},${ms}⟩`;
  document.getElementById('orb-disp').textContent=`${n}${SUBSHELLS[l]??'?'} orbital`;
  // Quick panel
  const ss=`${n}${SUBSHELLS[l]??'?'}`;
  document.getElementById('qp-subshell').textContent=ss;
  document.getElementById('qp-ket').textContent=`|${n},${l},${ms}⟩`;
  document.getElementById('qp-n').textContent=n;
  document.getElementById('qp-l').textContent=l;
  document.getElementById('qp-m').textContent=ms;
  document.getElementById('qp-icon-nlm').textContent=ss;
  // Advanced panel
  document.getElementById('vl-n').textContent=n;
  document.getElementById('vl-l').textContent=l;
  document.getElementById('vl-m').textContent=ms;
}

// Update the live particle-count readouts as the streamer grows the cloud.
export function updateInfoBar(count){
  const{n,l,m}=S; const ms=(m>=0?'+':'')+m;
  const el=document.getElementById('info-bar');
  if(el) el.innerHTML=`n=${n} l=${l} m=${ms} · ${count} pts`;
  const k=count>=1000?(count/1000).toFixed(1).replace('.0','')+'k':count;
  const qv=document.getElementById('qp-n-val'); if(qv) qv.textContent=k;
}

// Paint a slider's filled portion by setting the --pct custom property the CSS reads.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

/* ── Panel toggles ── */
function toggleAdv(){
  const p=document.getElementById('adv-panel');
  const b=document.getElementById('qp-adv-btn');
  const open=p.classList.toggle('adv-open');
  b.classList.toggle('adv-open-active',open);
  b.textContent=open?'✕ Close Adv':'⚙ Advanced';
}
function toggleQPCollapse(){
  document.getElementById('quick-panel').classList.toggle('qp-collapsed');
}
window.toggleAdv=toggleAdv;
window.toggleQPCollapse=toggleQPCollapse;

/* ── Quantum numbers ── */
// Clamp (n,ℓ,m) to the physically legal ranges (1≤n≤6, 0≤ℓ<n, |m|≤ℓ), push them
// into the hidden sliders, store into S, and refresh the display and AR panel.
export function applyQN(n,l,m){
  n=Math.max(1,Math.min(6,n));
  l=Math.max(0,Math.min(l,n-1));
  m=Math.max(-l,Math.min(m,l));
  document.getElementById('sl-n').value=n;
  const sl=document.getElementById('sl-l'); sl.max=n-1; sl.value=l;
  const sm=document.getElementById('sl-m'); sm.min=-l; sm.max=l; sm.value=m;
  ['sl-n','sl-l','sl-m'].forEach(id=>sg(document.getElementById(id)));
  S.n=n;S.l=l;S.m=m;
  updateDisplay();
  if(ARP.mesh) ARP.dirty=true;
}
export function syncQN(){
  applyQN(+document.getElementById('sl-n').value,
          +document.getElementById('sl-l').value,
          +document.getElementById('sl-m').value);
}

/* ── Particle count — synced between quick and adv sliders ── */
// Set the target count, format the k/M readout, mirror both sliders, and grow.
export function setN(val){
  S.N=val;
  const k=val>=1000000?(val/1000000).toFixed(1).replace('.0','')+'M':(val/1000).toFixed(1).replace('.0','')+'k';
  document.getElementById('vl-N').textContent=k;
  document.getElementById('qp-n-val').textContent=k;
  const qs=document.getElementById('qp-sl-n'); qs.value=val; sg(qs);
  const as=document.getElementById('sl-N');   as.value=val; sg(as);
  startGrow();
}

/* ── Color mode — synced quick and adv ── */
// Switch the visualization mode and flag colDirty so the loop recolors without
// rebuilding positions; keep both button rows and the AR panel in sync.
export function setColorMode(mode){
  S.colorMode=mode; S.colDirty=true;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',+b.dataset.mode===mode));
  document.querySelectorAll('.qp-mode').forEach(b=>b.classList.toggle('active',+b.dataset.mode===mode));
  if(ARP.mesh) ARP.dirty=true;
}

/* ── Animate toggle — synced quick panel toggle + adv checkbox ── */
// Turn the probability-flow animation on or off across every control that shows it.
export function setAnimate(on){
  S.animateFlow=on;
  document.getElementById('cb-flow-anim').checked=on;
  const tb=document.getElementById('qp-tog-anim');
  tb.classList.toggle('on',on); tb.classList.toggle('off',!on);
  tb.textContent=on?'▶ Animate':'▐▐ Paused';
  const ib=document.getElementById('qp-icon-anim');
  if(ib){ib.classList.toggle('on',on);ib.classList.toggle('off',!on);}
}
window.setAnimate=setAnimate;

/* ── B field toggle — synced quick panel, adv big-toggles, icon strip ── */
// Turn the magnetic field (arrows and tracers) on or off everywhere. Off hides
// the arrows and clears tracers; on with no cached field triggers a solve.
export function setMagField(on){
  S.showBField=on; S.showBTr=on;
  const bb=document.getElementById('btn-bfield-toggle');
  const bl=document.getElementById('bfield-state-lbl');
  const tb=document.getElementById('btn-btr-toggle');
  const tl=document.getElementById('btr-state-lbl');
  if(bb){bb.classList.toggle('active',on);bb.classList.toggle('off',!on);}
  if(bl) bl.textContent=on?'ON':'OFF';
  if(tb){tb.classList.toggle('active',on);tb.classList.toggle('off',!on);}
  if(tl) tl.textContent=on?'ON':'OFF';
  document.getElementById('bfield-opts').style.display=on?'block':'none';
  const qb=document.getElementById('qp-tog-b');
  qb.classList.toggle('on',on); qb.classList.toggle('off',!on);
  qb.textContent=on?'⊕ B Field':'⊗ B Field';
  const ib=document.getElementById('qp-icon-b');
  if(ib){ib.classList.toggle('on',on);ib.classList.toggle('off',!on);}
  if(!on){bArrowShaft.visible=false;btLines.visible=false;RT.bTracers=[];}
  else if(!RT.bFieldData) computeBField();
  if(ARP.mesh) ARP.dirty=true;
}
window.setMagField=setMagField;
// Wrappers for icon-strip inline onclick — S is module-scoped, not on window
window.toggleAnimateQP = () => setAnimate(!S.animateFlow);
window.toggleBFieldQP  = () => setMagField(!S.showBField);

// Register every DOM listener and run the initial setters. Called once from
// main.js after the modules are loaded, in the original wiring order.
export function initUI(){
  // QN steppers (quick panel): each minus/plus nudges one quantum number, then
  // flags the cloud dirty so the loop rebuilds it.
  document.querySelectorAll('.qp-step').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const qn=btn.dataset.qn,dir=+btn.dataset.dir;
      let{n,l,m}=S;
      if(qn==='n')n+=dir; else if(qn==='l')l+=dir; else if(qn==='m')m+=dir;
      applyQN(n,l,m); S.dirty=true;
    });
  });
  // QN sliders (advanced panel)
  ['sl-n','sl-l','sl-m'].forEach(id=>{
    const el=document.getElementById(id);
    el.addEventListener('input',()=>{syncQN();S.dirty=true;});
    sg(el);
  });

  document.getElementById('qp-sl-n').addEventListener('input',function(){setN(+this.value);sg(this);});
  sg(document.getElementById('qp-sl-n'));
  document.getElementById('sl-N').addEventListener('input',function(){setN(+this.value);});
  sg(document.getElementById('sl-N'));
  document.getElementById('sl-sz').addEventListener('input',function(){S.psize=+this.value;pMat.size=S.psize;document.getElementById('vl-sz').textContent=S.psize.toFixed(3);sg(this);});sg(document.getElementById('sl-sz'));
  document.getElementById('sl-ls').addEventListener('input',function(){S.scaler=+this.value;document.getElementById('vl-ls').textContent=S.scaler;sg(this);S.colDirty=true;});sg(document.getElementById('sl-ls'));

  document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>setColorMode(+b.dataset.mode)));
  document.querySelectorAll('.qp-mode').forEach(b=>b.addEventListener('click',()=>setColorMode(+b.dataset.mode)));

  document.getElementById('cb-flow-anim').addEventListener('change',function(){setAnimate(this.checked);});
  document.getElementById('qp-tog-anim').addEventListener('click',()=>setAnimate(!S.animateFlow));

  document.getElementById('btn-bfield-toggle').addEventListener('click',()=>{S.showBField=!S.showBField;setMagField(S.showBField);});
  document.getElementById('qp-tog-b').addEventListener('click',()=>setMagField(!S.showBField));

  /* ── B tracers adv toggle ── */
  (function(){
    const btn=document.getElementById('btn-btr-toggle');
    const lbl=document.getElementById('btr-state-lbl');
    function sync(){
      btn.classList.toggle('active',S.showBTr);btn.classList.toggle('off',!S.showBTr);
      lbl.textContent=S.showBTr?'ON':'OFF';
      document.getElementById('btr-opts').style.display=S.showBTr?'block':'none';
      if(!S.showBTr){btLines.visible=false;RT.bTracers=[];}
    }
    btn.addEventListener('click',()=>{S.showBTr=!S.showBTr;sync();});
    sync();
  })();

  /* ── B resolution presets ── */
  // Pick the Biot-Savart grid size (5³…24³) and resolve immediately if B is on.
  document.querySelectorAll('.res-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      S.bGridDim=+btn.dataset.dim;
      document.querySelectorAll('.res-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if(S.showBField) computeBField();
    });
  });

  /* ── Remaining adv sliders ── */
  // One input listener per advanced control: store into S, update the readout and
  // fill, and trigger a rebuild, recolor, or B re-upload only where that is needed.
  document.getElementById('cb-ev').addEventListener('change',function(){S.evolving=this.checked;});
  document.getElementById('sl-sp').addEventListener('input',function(){S.timeSpeed=+this.value;document.getElementById('vl-sp').textContent=S.timeSpeed.toFixed(1);sg(this);});sg(document.getElementById('sl-sp'));
  document.getElementById('cb-flow-tr').addEventListener('change',function(){S.showFlowTr=this.checked;document.getElementById('flow-tr-opts').style.display=this.checked?'block':'none';if(!this.checked){ftLines.visible=false;RT.flowTracers=[];}});
  document.getElementById('sl-fspd').addEventListener('input',function(){S.flowSpeed=+this.value;document.getElementById('vl-fspd').textContent=S.flowSpeed.toFixed(2);sg(this);});sg(document.getElementById('sl-fspd'));
  document.getElementById('sl-ftr-n').addEventListener('input',function(){S.flowTrCount=+this.value;document.getElementById('vl-ftr-n').textContent=this.value;sg(this);});sg(document.getElementById('sl-ftr-n'));
  document.getElementById('sl-ftr-tl').addEventListener('input',function(){S.flowTrTrail=+this.value;document.getElementById('vl-ftr-tl').textContent=this.value;sg(this);});sg(document.getElementById('sl-ftr-tl'));
  document.getElementById('sl-bgext').addEventListener('input',function(){S.bGridExtent=+this.value;document.getElementById('vl-bgext').textContent=this.value;sg(this);});sg(document.getElementById('sl-bgext'));
  document.getElementById('sl-basc').addEventListener('input',function(){S.bArrowScale=+this.value;document.getElementById('vl-basc').textContent=S.bArrowScale.toFixed(1);sg(this);if(RT.bFieldData)uploadBArrows();});sg(document.getElementById('sl-basc'));
  document.getElementById('sl-bgam').addEventListener('input',function(){S.bColGamma=+this.value;document.getElementById('vl-bgam').textContent=S.bColGamma.toFixed(1);sg(this);if(RT.bFieldData)uploadBArrows();});sg(document.getElementById('sl-bgam'));
  document.getElementById('sl-buev').addEventListener('input',function(){S.bUpdateEvery=+this.value;document.getElementById('vl-buev').textContent=this.value;sg(this);});sg(document.getElementById('sl-buev'));
  document.getElementById('btn-brecompute').addEventListener('click',()=>{if(S.showBField)computeBField();});
  document.getElementById('sl-bspd').addEventListener('input',function(){S.bTrSpeed=+this.value;document.getElementById('vl-bspd').textContent=S.bTrSpeed.toFixed(1);sg(this);});sg(document.getElementById('sl-bspd'));
  document.getElementById('sl-bspwn').addEventListener('input',function(){S.bTrSpawn=+this.value;document.getElementById('vl-bspwn').textContent=this.value;sg(this);});sg(document.getElementById('sl-bspwn'));
  document.getElementById('sl-btrl').addEventListener('input',function(){S.bTrTrail=+this.value;document.getElementById('vl-btrl').textContent=this.value;sg(this);});sg(document.getElementById('sl-btrl'));
  document.querySelectorAll('.view-btn[data-view]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.view-btn[data-view]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');S.viewMode=+btn.dataset.view;document.getElementById('cut-row').style.display=S.viewMode!==0?'block':'none';S.dirty=true;}));
  document.querySelectorAll('.view-btn[data-axis]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.view-btn[data-axis]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');S.cutAxis=+btn.dataset.axis;S.dirty=true;}));
  document.getElementById('sl-cut').addEventListener('input',function(){S.cutPos=+this.value;document.getElementById('vl-cut').textContent=S.cutPos.toFixed(1);sg(this);S.dirty=true;});sg(document.getElementById('sl-cut'));
  document.getElementById('cb-flow').addEventListener('change',function(){S.showFlow=this.checked;rebuildStaticFlow();});
  document.getElementById('cb-axes').addEventListener('change',function(){S.showAxes=this.checked;axesHelper.visible=this.checked;});

  // Keep camera aspect and canvas size matched to the window.
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

  // Init all toggles and displays
  // Run the toggle setters once so button states match S at start.
  setMagField(S.showBField);
  setAnimate(S.animateFlow);

  // Sync adv panel detail sliders to state defaults
  document.getElementById('sl-bgext').value=S.bGridExtent; sg(document.getElementById('sl-bgext'));
  document.getElementById('sl-basc').value=S.bArrowScale;  sg(document.getElementById('sl-basc'));
  document.getElementById('sl-buev').value=S.bUpdateEvery; sg(document.getElementById('sl-buev'));
  document.getElementById('sl-bspwn').value=S.bTrSpawn;    sg(document.getElementById('sl-bspwn'));
  document.getElementById('vl-bgext').textContent=S.bGridExtent;
  document.getElementById('vl-basc').textContent=S.bArrowScale.toFixed(1);
  document.getElementById('vl-buev').textContent=S.bUpdateEvery;
  document.getElementById('vl-bspwn').textContent=S.bTrSpawn;
}
