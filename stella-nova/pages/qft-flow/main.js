const $=id=>document.getElementById(id);
const TAU=Math.PI*2;
const S = { n:8, phi:[0,0,0,0,0,0,0,0], shotsIdx:0, sampleCounts:null, sampleTotal:0 };
const SHOT_TABLE=[0,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536,131072,262144,524288,1048576,2097152,4194304,8388608];

const wrap=a=>{a=((a+Math.PI)%TAU+TAU)%TAU-Math.PI;return a;};
function fmtPi(v){
  const r=v/Math.PI,near=(a,b)=>Math.abs(a-b)<0.01,s=r<0?'−':'';
  const fr=[[0,'0'],[0.25,'π/4'],[0.5,'π/2'],[0.75,'3π/4'],[1,'π']];
  for(const[k,t]of fr)if(near(Math.abs(r),k))return k===0?'0':s+t;
  return v.toFixed(2);
}
const N=()=>2**S.n;
const BAR_CAP=512, KET_CAP=16, SAMP_CAP=4096, STRIP_CAP=220, CURVE_M=1200;
const w2=j=>2**j;                                  // 2^j, safe past bit 31
function thetaAt(x){let s=0;for(let j=0;j<S.n;j++){if(Math.floor(x/w2(j))%2===1)s+=S.phi[j];}return s;}
const bin=(k,n)=>k.toString(2).padStart(n,'0');
const ket=(k,n)=>'|'+bin(k,n)+'\u27E9';

/* ── physics: closed-form spectrum of a bit-additive-phase flat signal ──
   P(k) = Π_j cos²((φ_j − 2π·k·2^j / N)/2).  Exact, O(n) per point → works at any n. */
function specClosed(kappa,N0){let p=1;for(let j=0;j<S.n;j++){const psi=S.phi[j]-TAU*kappa*w2(j)/N0;const c=Math.cos(psi*0.5);p*=c*c;}return p;}
function compute(){
  const N0=N(),M=CURVE_M,curve=new Float64Array(M+1);
  for(let i=0;i<=M;i++)curve[i]=specClosed(i/M*N0,N0);
  let probs=null;
  if(N0<=BAR_CAP){probs=new Float64Array(N0);for(let k=0;k<N0;k++)probs[k]=specClosed(k,N0);}
  // exact peak: refine the curve's argmax to the nearest integer bin
  let bi=0,bm=-1;for(let i=0;i<=M;i++)if(curve[i]>bm){bm=curve[i];bi=i;}
  let kpk=Math.round(bi/M*N0)%N0,pk=specClosed(kpk,N0);
  for(const kk of [kpk-1,kpk+1]){const k2=((kk%N0)+N0)%N0,p2=specClosed(k2,N0);if(p2>pk){pk=p2;kpk=k2;}}
  return {N0,probs,curve,M,peak:kpk,peakP:pk};
}

/* ── sampling (only feasible while the full 2^n distribution fits) ── */
function resample(R){
  const N0=R.N0,S0=SHOT_TABLE[S.shotsIdx];S.sampleTotal=S0;
  if(S0===0||!R.probs||N0>SAMP_CAP){S.sampleCounts=null;return;}
  const cum=new Float64Array(N0);let acc=0;for(let k=0;k<N0;k++){acc+=R.probs[k];cum[k]=acc;}
  const counts=new Float64Array(N0);
  for(let s=0;s<S0;s++){const r=Math.random()*acc;let lo=0,hi=N0-1;
    while(lo<hi){const m=(lo+hi)>>1;if(cum[m]<r)lo=m+1;else hi=m;}counts[lo]++;}
  S.sampleCounts=counts;
}

/* ── canvas helpers ── */
function fit(cv){const dpr=Math.min(devicePixelRatio||1,2),w=cv.clientWidth,h=cv.clientHeight;
  if(cv.width!==(w*dpr|0)||cv.height!==(h*dpr|0)){cv.width=w*dpr|0;cv.height=h*dpr|0;}
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);return {c,w,h};}
const phaseHue=p=>{const n=(wrap(p)+Math.PI)/TAU;return `hsl(${(n*340+10)|0} 90% 62%)`;};

function drawMag(R){
  const {c,w,h}=fit($('cv-mag')),N0=R.N0,m=Math.min(N0,STRIP_CAP),pad=10,bw=(w-pad*2)/m,base=h-22,amp=1/Math.sqrt(N0);
  c.strokeStyle='rgba(90,130,180,0.10)';c.lineWidth=1;
  for(let g=0;g<=4;g++){const y=14+(base-14)*g/4;c.beginPath();c.moveTo(pad,y);c.lineTo(w-pad,y);c.stroke();}
  const bh=(base-14)*0.78;
  for(let x=0;x<m;x++){const bx=pad+x*bw+bw*0.16,bwid=Math.max(1,bw*0.68);
    c.fillStyle='rgba(69,211,255,0.32)';c.fillRect(bx,base-bh,bwid,bh);
    c.fillStyle='rgba(69,211,255,0.85)';c.fillRect(bx,base-bh,bwid,2);}
  c.fillStyle='rgba(86,100,128,0.9)';c.font="9px 'JetBrains Mono'";c.textAlign='center';
  c.fillText(N0>m?('all '+N0.toLocaleString()+' equal · '+m+' shown'):'all bars equal — magnitude carries no info',w/2,h-6);
  $('mag-r').textContent='all = '+(amp>=0.01?amp.toFixed(3):amp.toExponential(1));
}
function drawPhase(R){
  const {c,w,h}=fit($('cv-phase')),N0=R.N0,m=Math.min(N0,STRIP_CAP),pad=10,bw=(w-pad*2)/m,top=14,bot=h-22;
  const th=new Array(m);
  for(let i=0;i<m;i++){const x=m<N0?Math.round(i/(m-1)*(N0-1)):i;th[i]=thetaAt(x);}
  let mn=Infinity,mx=-Infinity;for(let i=0;i<m;i++){mn=Math.min(mn,th[i]);mx=Math.max(mx,th[i]);}
  if(mx-mn<1e-6){mn-=Math.PI;mx+=Math.PI;}
  const pad2=(mx-mn)*0.12;mn-=pad2;mx+=pad2;
  const Y=v=>bot-(v-mn)/(mx-mn)*(bot-top);
  c.strokeStyle='rgba(90,130,180,0.10)';c.lineWidth=1;
  for(let g=0;g<=4;g++){const y=top+(bot-top)*g/4;c.beginPath();c.moveTo(pad,y);c.lineTo(w-pad,y);c.stroke();}
  if(mn<0&&mx>0){c.strokeStyle='rgba(120,170,230,0.25)';c.setLineDash([3,3]);c.beginPath();c.moveTo(pad,Y(0));c.lineTo(w-pad,Y(0));c.stroke();c.setLineDash([]);}
  c.strokeStyle='rgba(120,170,230,0.30)';c.lineWidth=1.4;c.beginPath();
  for(let i=0;i<m;i++){const px=pad+i*bw+bw/2,py=Y(th[i]);i?c.lineTo(px,py):c.moveTo(px,py);}c.stroke();
  const dotR=Math.max(1.4,Math.min(4,bw*0.3));
  for(let i=0;i<m;i++){const px=pad+i*bw+bw/2,py=Y(th[i]);
    c.strokeStyle='rgba(120,170,230,0.14)';c.beginPath();c.moveTo(px,bot);c.lineTo(px,py);c.stroke();
    c.fillStyle=phaseHue(th[i]);c.beginPath();c.arc(px,py,dotR,0,TAU);c.fill();}
  c.fillStyle='rgba(86,100,128,0.9)';c.font="9px 'JetBrains Mono'";c.textAlign='center';
  c.fillText('x = 0 … '+(N0-1).toLocaleString()+(m<N0?' · '+m+' sampled':'')+'  (basis index)',w/2,h-6);
  $('phase-r').textContent='span '+(mx-mn-2*pad2).toFixed(2)+' rad';
}
function fmtK(v){return v>=100000?v.toExponential(1):''+Math.round(v);}
function drawOut(R){
  const {c,w,h}=fit($('cv-out')),N0=R.N0,padL=12,padR=12,top=16,bot=h-26;
  const plotW=w-padL-padR;
  let pmax=0;for(let i=0;i<=R.M;i++)pmax=Math.max(pmax,R.curve[i]);
  if(R.probs)for(let k=0;k<N0;k++)pmax=Math.max(pmax,R.probs[k]);
  pmax=Math.max(pmax,1e-9);const yMax=pmax*1.08;
  const X=k=>padL+(k/N0)*plotW, Y=p=>bot-(p/yMax)*(bot-top);
  c.strokeStyle='rgba(90,130,180,0.09)';c.lineWidth=1;
  for(let g=0;g<=4;g++){const y=top+(bot-top)*g/4;c.beginPath();c.moveTo(padL,y);c.lineTo(w-padR,y);c.stroke();}
  const pred=predBin();if(pred!=null){const gx=X(pred+0.5);c.strokeStyle='rgba(255,182,72,0.35)';c.setLineDash([4,4]);
    c.beginPath();c.moveTo(gx,top);c.lineTo(gx,bot);c.stroke();c.setLineDash([]);}
  // smooth continuous spectrum (filled + glow)
  c.beginPath();c.moveTo(padL,bot);
  for(let i=0;i<=R.M;i++){const x=padL+(i/R.M)*plotW,y=Y(R.curve[i]);c.lineTo(x,y);}
  c.lineTo(w-padR,bot);c.closePath();
  const grad=c.createLinearGradient(0,top,0,bot);grad.addColorStop(0,'rgba(69,211,255,0.30)');grad.addColorStop(1,'rgba(69,211,255,0.02)');
  c.fillStyle=grad;c.fill();
  c.shadowColor='rgba(69,211,255,0.55)';c.shadowBlur=9;c.strokeStyle='rgba(120,235,255,0.92)';c.lineWidth=1.6;
  c.beginPath();for(let i=0;i<=R.M;i++){const x=padL+(i/R.M)*plotW,y=Y(R.curve[i]);i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
  c.shadowBlur=0;
  const slot=plotW/N0;
  if(R.probs){const dots=N0<=64;
    for(let k=0;k<N0;k++){const cx=X(k)+slot/2,y=Y(R.probs[k]);
      c.strokeStyle='rgba(255,182,72,0.45)';c.lineWidth=Math.min(1.4,Math.max(0.5,slot*0.5));c.beginPath();c.moveTo(cx,bot);c.lineTo(cx,y);c.stroke();
      if(dots){c.fillStyle='#ffb648';c.beginPath();c.arc(cx,y,Math.max(2,Math.min(3.5,slot*0.18)),0,TAU);c.fill();}}
    if(S.sampleCounts){const tot=S.sampleTotal;
      c.strokeStyle='rgba(255,107,138,0.9)';c.lineWidth=1.3;c.beginPath();
      for(let k=0;k<N0;k++){const p=S.sampleCounts[k]/tot,x0=X(k)+slot*0.18,x1=X(k)+slot*0.82,y=Y(p);
        c.moveTo(x0,bot);c.lineTo(x0,y);c.lineTo(x1,y);c.lineTo(x1,bot);}c.stroke();}
  }else{
    c.fillStyle='rgba(120,170,230,0.55)';c.font="9px 'JetBrains Mono'";c.textAlign='center';
    c.fillText('2\u207F = '+N0.toLocaleString()+' bins — too dense to resolve individually; exact continuous spectrum shown',w/2,bot-8);
  }
  // periodic-wrap marker
  c.fillStyle='rgba(120,170,230,0.5)';c.font="8px 'JetBrains Mono'";c.textAlign='right';
  c.fillText('\u21BB k\u2261'+N0.toLocaleString()+' \u2261 0',w-padR-2,top+11);
  // axis ticks
  c.fillStyle='rgba(86,100,128,0.92)';c.textAlign='center';
  if(N0<=KET_CAP){c.font="8px 'JetBrains Mono'";for(let k=0;k<N0;k++)c.fillText(bin(k,S.n),X(k)+slot/2,h-9);}
  else{c.font="9px 'JetBrains Mono'";for(let t=0;t<=4;t++)c.fillText(fmtK(t/4*N0),padL+(t/4)*plotW,h-9);}
  // peak callout
  const peak=R.peak,pk=R.peakP,px=X(peak)+slot/2,py=Y(pk),left=peak<N0*0.6;
  const lab=(S.n<=10?ket(peak,S.n):'bin '+peak.toLocaleString())+'  '+(pk*100).toFixed(1)+'%';
  c.fillStyle='#ffd27a';c.font="600 11px 'JetBrains Mono'";c.textAlign=left?'left':'right';
  c.fillText(lab,left?px+6:px-6,Math.max(top+13,py-6));
  c.textAlign='left';c.fillStyle='rgba(86,100,128,0.92)';c.font="9px 'JetBrains Mono'";
  c.fillText('basis state '+(N0<=KET_CAP?'|b\u2099\u2026b\u2080\u27E9':'bin k')+'  (frequency)',padL,12);
}

/* ── stats / readouts ── */
function predBin(){ // peak bin implied by the linear-ramp part of phi (uses phi_0 weight ladder)
  const a=parseFloat($('alpha').value); // displayed ramp slope
  if(a<=0)return null; const b=a*N()/TAU; return Math.max(0,Math.min(N()-1,b));
}
function updateStats(R){
  const N0=R.N0,peak=R.peak,pk=R.peakP;
  let ipr,approx=false;
  if(R.probs){let s2=0;for(let k=0;k<N0;k++)s2+=R.probs[k]*R.probs[k];ipr=s2>0?1/s2:N0;}
  else{let s2=0;for(let i=0;i<=R.M;i++)s2+=R.curve[i]*R.curve[i];s2*=N0/R.M;ipr=s2>0?1/s2:N0;approx=true;}
  $('st-peak').textContent=S.n<=10?ket(peak,S.n):'bin '+peak.toLocaleString();
  $('st-peak').style.fontSize=S.n>8?'0.7rem':(S.n>5?'0.82rem':(S.n>4?'0.95rem':'1.15rem'));
  $('st-prob').innerHTML=(pk*100).toFixed(1)+'<small>%</small>';
  $('st-spread').innerHTML=(approx?'~':'')+ipr.toFixed(ipr<100?1:0)+'<small> bins</small>';
  const pred=predBin();
  $('st-pred').textContent=pred==null?'\u2014':(pred>=1e5?pred.toExponential(1):pred.toFixed(2));
  $('out-r').textContent='peak '+(pk*100).toFixed(1)+'% @ '+(S.n<=10?ket(peak,S.n):'bin '+peak.toLocaleString());
}

/* ── render ── */
function render(){const R=compute();
  const tooBig=R.N0>SAMP_CAP, sl=$('shots');
  if(sl){sl.disabled=tooBig;sl.style.opacity=tooBig?0.4:1;}
  $('shots-val').textContent=tooBig?'exact only':(S.shotsIdx===0?'exact':SHOT_TABLE[S.shotsIdx].toLocaleString());
  if(S.shotsIdx>0)resample(R); // resample each change so the measured histogram tracks the current state
  drawMag(R);drawPhase(R);drawOut(R);updateStats(R);
}

/* ── controls ── */
function buildPhiSliders(){
  const host=$('phi-sliders');host.innerHTML='';
  const CH=[['0',0],['π/2',Math.PI/2],['π',Math.PI],['3π/2',3*Math.PI/2],['2π',TAU]];
  for(let j=0;j<S.n;j++){
    const chips=CH.map(([lab,v])=>`<button data-j="${j}" data-v="${v}">${lab}</button>`).join('');
    const d=document.createElement('div');d.className='slider';
    d.innerHTML=`<div class="head"><span class="k">φ<b>${j}</b> <span class="w">· weight 2<sup>${j}</sup>=${(2**j).toLocaleString()}</span></span><span class="val" id="pv${j}"></span></div>
      <input type="range" min="-6.2832" max="6.2832" step="0.001" id="ph${j}" value="${S.phi[j]}">
      <div class="chips" id="ch${j}">${chips}</div>`;
    host.appendChild(d);
  }
  for(let j=0;j<S.n;j++){const sl=$('ph'+j);
    sl.addEventListener('input',()=>{S.phi[j]=parseFloat(sl.value);clearAlpha();syncPhiLabels();render();});}
  host.querySelectorAll('.chips button').forEach(b=>b.addEventListener('click',()=>{
    S.phi[+b.dataset.j]=parseFloat(b.dataset.v);clearAlpha();syncPhiLabels();render();}));
  syncPhiLabels();
}
function clearAlpha(){$('alpha').value=0;$('alpha-val').textContent='0.00';}
function syncPhiLabels(){for(let j=0;j<S.n;j++){const v=$('pv'+j);if(v)v.textContent=fmtPi(S.phi[j])+'  '+S.phi[j].toFixed(2);
  const sl=$('ph'+j);if(sl&&document.activeElement!==sl)sl.value=S.phi[j];
  const ch=$('ch'+j);if(ch){const cur=S.phi[j];ch.querySelectorAll('button').forEach(b=>b.classList.toggle('on',Math.abs(parseFloat(b.dataset.v)-cur)<0.02));}}}
function setN(n){n=Math.max(1,Math.min(20,n));S.n=n;S.phi=Array.from({length:n},(_,j)=>S.phi[j]||0);
  $('n-val').firstChild.textContent=n+' ';$('dim-val').textContent='· '+(n<=20?(2**n).toLocaleString():'2^'+n)+' bins';
  S.sampleCounts=null;buildPhiSliders();render();}

function applyRamp(a){for(let j=0;j<S.n;j++)S.phi[j]=wrap(a*(1<<j));$('alpha').value=a;$('alpha-val').textContent=a.toFixed(2);syncPhiLabels();render();}
$('alpha').addEventListener('input',e=>applyRamp(parseFloat(e.target.value)));

$('n-minus').onclick=()=>setN(S.n-1);
$('n-plus').onclick=()=>setN(S.n+1);

document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{
  const p=b.dataset.preset,N0=N();
  if(p==='flat'){S.phi=Array(S.n).fill(0);$('alpha').value=0;$('alpha-val').textContent='0.00';}
  else if(p==='ramp'){const m=Math.max(1,Math.round(N0*0.31));const a=TAU*m/N0;applyRamp(a);return;}
  else if(p==='detune'){const m=Math.max(1,Math.round(N0*0.31));const a=TAU*m/N0;
    for(let j=0;j<S.n;j++)S.phi[j]=wrap(a*(1<<j));S.phi[0]=wrap(S.phi[0]+0.9);$('alpha').value=a;$('alpha-val').textContent=a.toFixed(2);}
  else if(p==='random'){S.phi=Array.from({length:S.n},()=>(Math.random()*2-1)*Math.PI);$('alpha').value=0;$('alpha-val').textContent='0.00';}
  syncPhiLabels();render();
}));

$('shots').addEventListener('input',e=>{S.shotsIdx=+e.target.value;
  $('shots-val').textContent=S.shotsIdx===0?'exact':SHOT_TABLE[S.shotsIdx].toLocaleString();
  S.sampleCounts=null;render();});
$('resample').onclick=()=>{if(S.shotsIdx>0){S.sampleCounts=null;render();}};

window.addEventListener('resize',()=>render());
setN(8);applyRamp(0);
if(window.renderMathInElement)renderMathInElement(document.body,{delimiters:[
  {left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});
