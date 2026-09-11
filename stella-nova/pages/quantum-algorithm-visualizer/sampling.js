// QAVE sampling: the Gaussian-paced measurement shot animation (runSampling/
// updateSampling/oneShot), the 3D result bars and diagonal glow, and the 2D
// histogram (drawHistogram). initSampling wires the sample/close buttons.
//   grep -n "function runSampling" sampling.js   grep -n "function drawHistogram" sampling.js
import * as THREE from 'three';
import { VS, RT, dummy, _col, PITCH, CUBE, LAYER_GAP, BARMAX, $, totalStackTime } from './core.js';
import { frameCamera } from './scene.js';
import { makeRng, sampleOutcome } from './quantum.js';
import { heatColor, curveEval } from './color.js';


/* ════════ measurement sampling — lit one shot at a time, Gaussian-paced ════════ */
// 2D histogram canvas and the current sampling animation state (null when idle).
const histCv=document.getElementById('hist-canvas'),hctx=histCv.getContext('2d');
// Abramowitz-Stegun approximation of the error function, for the pacing curve.
function erf(x){const s=x<0?-1:1;x=Math.abs(x);const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return s*y;}
const _S0=0.5*(1+erf((0-0.5)/(0.19*Math.SQRT2))),_S1=0.5*(1+erf((1-0.5)/(0.19*Math.SQRT2)));
function sCurve(p){const s=0.5*(1+erf((p-0.5)/(0.19*Math.SQRT2)));return Math.min(1,Math.max(0,(s-_S0)/(_S1-_S0)));} // integral of a Gaussian rate: slow→fast→slow
// Position the additive glow cubes over the diagonal (population) cells of the
// sampling layer, ready to be lit as shots arrive.
function placeSampleGlow(L){                                 // diagonal (population) cells of the sampling layer
  for(let i=0;i<RT.DIM;i++){const x=(i-(RT.DIM-1)/2)*PITCH,z=(i-(RT.DIM-1)/2)*PITCH;
    const y=(VS.viewMode==='floor')?CUBE*0.5:L*LAYER_GAP+CUBE*0.5;
    dummy.position.set(x,y,z);dummy.scale.set(1,1,1);dummy.updateMatrix();RT.sampleMesh.setMatrixAt(i,dummy.matrix);}
  RT.sampleMesh.instanceMatrix.needsUpdate=true;RT.sampleMesh.count=RT.DIM;
}
// Size the 3D result bars from the empirical counts and place the amber crossbar
// at each state's true probability, so the bars visibly converge to the marks.
function updateHistBars(A){
  if(!RT.histBars||RT.histBars.count!==A.D)return;
  const baseY=(VS.viewMode==='floor')?CUBE:A.layer*LAYER_GAP+CUBE;     // top of the sampling layer's cells
  let scale=1e-4;for(let i=0;i<A.D;i++)scale=Math.max(scale,A.counts[i]/Math.max(1,A.drawn),A.probs[i]);
  const breathe=0.82+0.18*Math.sin(A.gp);
  for(let i=0;i<A.D;i++){const dx=(i-(A.D-1)/2)*PITCH;                 // diagonal cell (i,i): x = z
    const emp=A.counts[i]/Math.max(1,A.drawn),h=Math.max(1e-4,(emp/scale)*BARMAX);
    dummy.position.set(dx,baseY,dx);dummy.scale.set(1,h,1);dummy.updateMatrix();RT.histBars.setMatrixAt(i,dummy.matrix);
    const col=heatColor(0.04+0.96*(emp/scale)),b=breathe*(1+A.pulses[i]*1.4);
    _col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b,THREE.SRGBColorSpace);RT.histBars.setColorAt(i,_col);
    const th=baseY+Math.max(1e-4,(A.probs[i]/scale)*BARMAX);          // amber target at the true probability
    dummy.position.set(dx,th,dx);dummy.scale.set(1,1,1);dummy.updateMatrix();RT.histMarks.setMatrixAt(i,dummy.matrix);}
  RT.histBars.instanceMatrix.needsUpdate=true;if(RT.histBars.instanceColor)RT.histBars.instanceColor.needsUpdate=true;
  RT.histMarks.instanceMatrix.needsUpdate=true;
}
// Start the measurement sampler: force the stack view fully revealed, pick the
// layer just before collapse, compute its true |ψ|² distribution, and set up the
// animation state (counts, pulses, seeded RNG) plus the on-screen bars.
function runSampling(){
  if(!RT.trace)return;
  if(VS.viewMode!=='stack'){VS.viewMode='stack';document.querySelectorAll('.dock-view').forEach(b=>b.classList.toggle('active',b.dataset.view==='stack'));}
  VS.showFull=true;const tf=document.getElementById('tog-full');if(tf)tf.classList.add('on');
  VS.stageTime=totalStackTime();VS.playing=false;$('btn-play')&&($('btn-play').textContent='▶ Play',$('btn-play').classList.remove('active')); // reveal whole tower so the sampled layer is in view
  let sampleLayer=RT.totalLayers-1;const mi=RT.trace.steps.findIndex(s=>s.kind==='measurement');
  if(mi>=0)sampleLayer=mi;                                   // the superposition right before measurement collapses it
  const st=RT.layerStates[sampleLayer],D=1<<VS.numQubits;
  const probs=new Array(D);let sm=0;for(let i=0;i<D;i++){const p=st.re[i]*st.re[i]+st.im[i]*st.im[i];probs[i]=p;sm+=p;}
  if(sm>0)for(let i=0;i<D;i++)probs[i]/=sm;
  const shots=Math.max(0,Math.round(+document.getElementById('sl-shots').value));
  const gap=Math.max(0,+document.getElementById('sl-gap').value);
  RT.sampleAnim={probs,D,layer:sampleLayer,counts:new Array(D).fill(0),pulses:new Float32Array(D),maxc:1,
    drawn:0,shots,gap,acc:gap,gp:0,done:false,rng:makeRng((((VS.seed+1)*2654435761)>>>0)||1)};
  placeSampleGlow(sampleLayer);
  RT.histBars.count=D;RT.histMarks.count=D;
  for(let i=0;i<D;i++)RT.histMarks.setColorAt(i,_col.setRGB(1,0.72,0.28,THREE.SRGBColorSpace));
  if(RT.histMarks.instanceColor)RT.histMarks.instanceColor.needsUpdate=true;
  RT.histGroup.visible=true;
  document.getElementById('hist-panel').classList.add('show');frameCamera();
}
// Advance sampling each frame: emit shots at a Gaussian-shaped rate (slow at the
// ends, fast in the middle), decay the per-cell pulses, and repaint bars/glow.
function updateSampling(dt){
  const A=RT.sampleAnim;if(!A)return;A.gp+=dt*5;
  if(!A.done){
    if(A.gap<=0.001){while(A.drawn<A.shots)oneShot(A);}     // gap≈0 → emit all at once
    else{
      A.acc+=dt;
      while(A.drawn<A.shots){                                // Gaussian-shaped rate: ~0.7s gaps at the ends, fast through the middle
        const e=Math.min(A.drawn,A.shots-1-A.drawn),r=e/4,ramp=Math.exp(-0.5*r*r);
        const g=0.006+(A.gap-0.006)*ramp;                     // start/end ≈ slider gap (slow); centre ≈ 6ms (fast)
        if(A.acc<g)break;A.acc-=g;oneShot(A);
      }
    }
    if(A.drawn>=A.shots)A.done=true;
  }
  const decay=Math.exp(-dt*4);for(let i=0;i<A.D;i++)A.pulses[i]*=decay;
  paintSampleGlow(A);updateHistBars(A);drawHistogram(A);
}
// Draw one measurement shot: sample an outcome, bump its count, flash its pulse.
function oneShot(A){const idx=sampleOutcome(A.rng,A.probs);A.counts[idx]++;A.pulses[idx]=1;A.drawn++;if(A.counts[idx]>A.maxc)A.maxc=A.counts[idx];}
// Light the diagonal glow cubes: steady brightness by count, spike on a fresh hit.
function paintSampleGlow(A){
  if(!RT.sampleMesh||RT.sampleMesh.count!==A.D)return;
  const breathe=0.75+0.25*Math.sin(A.gp);
  for(let i=0;i<A.D;i++){const norm=A.counts[i]/A.maxc;
    const b=norm*breathe*1.25 + A.pulses[i]*2.2;            // steady glow ∝ count, plus a spike each time it's hit
    if(b<=0.001){_col.setRGB(0,0,0,THREE.SRGBColorSpace);}
    else{const col=heatColor(0.01+0.99*curveEval(norm));_col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b,THREE.SRGBColorSpace);}
    RT.sampleMesh.setColorAt(i,_col);}
  if(RT.sampleMesh.instanceColor)RT.sampleMesh.instanceColor.needsUpdate=true;
}
// Draw the 2D histogram panel: empirical bars per basis state with an amber line
// at the true probability, plus the shots-drawn readout.
function drawHistogram(A){
  const dpr=Math.min(devicePixelRatio||1,2),W=histCv.clientWidth||600,H=histCv.clientHeight||96;
  if(histCv.width!==Math.round(W*dpr)||histCv.height!==Math.round(H*dpr)){histCv.width=Math.round(W*dpr);histCv.height=Math.round(H*dpr);}
  hctx.setTransform(dpr,0,0,dpr,0,0);hctx.clearRect(0,0,W,H);
  const D=A.D,padL=8,padR=W-8,padB=H-4,padT=4,bw=(padR-padL)/D;
  let maxP=1e-4;for(let i=0;i<D;i++){maxP=Math.max(maxP,A.probs[i],A.counts[i]/Math.max(1,A.drawn));}
  for(let i=0;i<D;i++){const x=padL+i*bw,emp=A.counts[i]/Math.max(1,A.drawn);
    const eh=(emp/maxP)*(padB-padT),col=heatColor(A.probs[i]/maxP),fl=A.pulses?A.pulses[i]:0;
    const br=1+fl*1.6;hctx.fillStyle='rgba('+Math.min(255,col[0]*br|0)+','+Math.min(255,col[1]*br|0)+','+Math.min(255,col[2]*br|0)+','+(0.9+0.1*fl)+')';
    hctx.fillRect(x+bw*0.12,padB-eh,Math.max(1,bw*0.76),eh);
    const th=(A.probs[i]/maxP)*(padB-padT);hctx.strokeStyle='rgba(255,200,80,0.85)';hctx.lineWidth=1;hctx.beginPath();hctx.moveTo(x+bw*0.05,padB-th);hctx.lineTo(x+bw*0.95,padB-th);hctx.stroke();}
  hctx.strokeStyle='rgba(70,95,135,0.5)';hctx.lineWidth=1;hctx.beginPath();hctx.moveTo(padL,padB+0.5);hctx.lineTo(padR,padB+0.5);hctx.stroke();
  document.getElementById('hist-info').innerHTML='<b>'+A.drawn+'</b> / '+A.shots+' shots · '+D+' basis states · amber line = true |ψ|²';
}
// Stop and clear the sampler and hide its 3D bars.
function stopSampling(){RT.sampleAnim=null;if(RT.sampleMesh)RT.sampleMesh.count=0;if(RT.histGroup)RT.histGroup.visible=false;if(RT.histBars)RT.histBars.count=0;if(RT.histMarks)RT.histMarks.count=0;}


export function initSampling(){
document.getElementById('btn-sample').onclick=runSampling;
document.getElementById('hist-close').onclick=()=>{document.getElementById('hist-panel').classList.remove('show');stopSampling();};
}

export { updateSampling, stopSampling };
