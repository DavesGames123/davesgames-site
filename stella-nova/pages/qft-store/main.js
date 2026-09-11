const $=id=>document.getElementById(id);
const TAU=Math.PI*2;
const S={ n:10, bits:8, amp:true, payload:'Hello, Stella Nova!' };
const slotsPerQ=()=>S.amp?2:1;
const numSlots=()=>S.n*slotsPerQ();
const capBytes=()=>Math.floor(numSlots()*S.bits/8);

/* build the flat slot list: for amp → [θ0,φ0,θ1,φ1,…]; phase → [φ0,φ1,…] */
function slotList(){const L=[];for(let j=0;j<S.n;j++){if(S.amp)L.push({type:'t',q:j});L.push({type:'p',q:j});}return L;}
const stepFor=t=>(t==='t'?Math.PI/2:TAU)/(2**S.bits);

let STATE={th:[],ph:[],storedBytes:0,truncated:false};

function encode(){
  const bytes=new TextEncoder().encode(S.payload);
  const cap=capBytes(),truncated=bytes.length>cap,used=Math.min(bytes.length,cap);
  // bitstream (MSB first per byte)
  const bits=[];for(let i=0;i<used;i++)for(let b=7;b>=0;b--)bits.push((bytes[i]>>b)&1);
  const slots=slotList();while(bits.length<slots.length*S.bits)bits.push(0);
  const th=Array(S.n).fill(S.amp?0:Math.PI/2), ph=Array(S.n).fill(0);
  slots.forEach((s,si)=>{let lvl=0;for(let b=0;b<S.bits;b++)lvl=(lvl<<1)|bits[si*S.bits+b];
    const ang=lvl*stepFor(s.type);if(s.type==='t')th[s.q]=ang;else ph[s.q]=ang;});
  STATE={th,ph,storedBytes:used,truncated};
}
function decode(){
  const slots=slotList(),bits=[];
  slots.forEach(s=>{const ang=(s.type==='t'?STATE.th[s.q]:STATE.ph[s.q]);
    let lvl=Math.round(ang/stepFor(s.type));lvl=Math.max(0,Math.min(2**S.bits-1,lvl));
    for(let b=S.bits-1;b>=0;b--)bits.push((lvl>>b)&1);});
  const out=new Uint8Array(STATE.storedBytes);
  for(let i=0;i<STATE.storedBytes;i++){let v=0;for(let b=0;b<8;b++)v=(v<<1)|bits[i*8+b];out[i]=v;}
  return new TextDecoder().decode(out);
}

/* ── render ── */
function render(){
  encode();
  $('n-val').textContent=S.n;$('b-val').textContent=S.bits;$('ampmode').classList.toggle('on',S.amp);
  const cap=capBytes(),used=STATE.storedBytes;
  $('capnum').textContent=used+' / '+cap+' bytes  ·  '+numSlots()+'×'+S.bits+' = '+(numSlots()*S.bits)+' bits';
  $('capfill').style.width=Math.min(100,cap?used/cap*100:0)+'%';
  $('holevo').innerHTML='simulator: '+(numSlots()*S.bits)+' bits · real hardware (Holevo): only <b>'+S.n+'</b> bits retrievable';
  $('capfill').style.background=STATE.truncated?'var(--rose)':'var(--green)';
  $('reg-note').innerHTML=`<b>${numSlots()}</b> angle dials × <b>${S.bits}</b> bits = <b>${numSlots()*S.bits}</b> bits (${cap} bytes). `+(S.amp?'Each qubit carries a θ and a φ.':'Phase only — one φ per qubit.');
  $('slots-tag').textContent=numSlots()+' dials';
  buildDials();
  const dec=decode();
  $('decoded').textContent=dec||'∅';
  const exact=dec===S.payload;
  $('match').className='badge '+(exact?'ok':'warn');
  $('match').innerHTML=exact?'✓ exact round-trip — bytes recovered with zero loss'
    :(STATE.truncated?'✗ payload exceeds capacity — '+(S.payload.length-cap)+' byte(s) dropped. Add qubits or bits.':'✗ mismatch');
  drawWave();
}
function buildDials(){const host=$('dials');host.innerHTML='';
  for(let j=0;j<S.n;j++){const th=STATE.th[j],ph=STATE.ph[j];
    const r=13*Math.sin(th), ex=17+r*Math.cos(ph-Math.PI/2), ey=17+r*Math.sin(ph-Math.PI/2);
    const d=document.createElement('div');d.className='dial';
    d.innerHTML=`<svg viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="13" fill="none" stroke="rgba(150,200,255,0.16)" stroke-width="1.2"/>
      <ellipse cx="17" cy="17" rx="13" ry="${(13*Math.cos(th)).toFixed(1)}" fill="none" stroke="rgba(150,200,255,0.10)" stroke-width="1"/>
      <line x1="17" y1="17" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#45d3ff" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2" fill="#ffb948"/></svg>
      <span class="dj">q${j}</span>`;
    host.appendChild(d);}
}
function drawWave(){const cv=$('cv-wave'),dpr=Math.min(devicePixelRatio||1,2),w=cv.clientWidth,h=cv.clientHeight;
  if(cv.width!==(w*dpr|0)||cv.height!==(h*dpr|0)){cv.width=w*dpr|0;cv.height=h*dpr|0;}
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  const N0=2**S.n,M=420,padL=10,padR=10,top=10,bot=h-18,plotW=w-padL-padR;
  const spec=k=>{let p=1;for(let j=0;j<S.n;j++){const w2=TAU*2**j/N0;p*=1+Math.sin(2*STATE.th[j])*Math.cos(STATE.ph[j]-w2*k);}return p/N0;};
  let mx=1e-12;const P=new Float64Array(M+1);for(let i=0;i<=M;i++){P[i]=spec(i/M*N0);mx=Math.max(mx,P[i]);}
  const X=i=>padL+(i/M)*plotW,Y=v=>bot-(v/mx)*(bot-top);
  c.strokeStyle='rgba(90,130,180,0.09)';c.lineWidth=1;for(let g=0;g<=3;g++){const y=top+(bot-top)*g/3;c.beginPath();c.moveTo(padL,y);c.lineTo(w-padR,y);c.stroke();}
  c.beginPath();c.moveTo(padL,bot);for(let i=0;i<=M;i++)c.lineTo(X(i),Y(P[i]));c.lineTo(w-padR,bot);c.closePath();
  const grad=c.createLinearGradient(0,top,0,bot);grad.addColorStop(0,'rgba(168,156,255,0.30)');grad.addColorStop(1,'rgba(168,156,255,0.02)');c.fillStyle=grad;c.fill();
  c.strokeStyle='rgba(168,156,255,0.9)';c.lineWidth=1.4;c.beginPath();for(let i=0;i<=M;i++){const x=X(i),y=Y(P[i]);i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
  c.fillStyle='rgba(86,100,128,0.9)';c.font="9px 'JetBrains Mono'";c.textAlign='left';c.fillText('frequency k/N',padL,h-5);
}

/* ── controls ── */
$('payload').addEventListener('input',e=>{S.payload=e.target.value;render();});
$('bits').addEventListener('input',e=>{S.bits=+e.target.value;render();});
$('ampmode').onclick=()=>{S.amp=!S.amp;render();};
$('n-minus').onclick=()=>{S.n=Math.max(1,S.n-1);render();};
$('n-plus').onclick=()=>{S.n=Math.min(20,S.n+1);render();};
window.addEventListener('resize',drawWave);
render();
