// ============================================================================
//  SPIN STORAGE  ·  store bytes losslessly in qubit rotation angles
// ----------------------------------------------------------------------------
//  Each qubit exposes real rotation dials: an amplitude angle θ and a phase
//  angle φ. This page treats those dials as a plain register. It packs the
//  payload's bits into dial "levels", maps each level to an angle, then reads
//  the angles back and reassembles the bytes. Exact in this simulator; a real
//  device could not read an angle without collapsing the state, and Holevo's
//  theorem caps what is retrievable at n classical bits regardless of B.
//
//  ENCODE / DECODE PIPELINE
//  ----------------------------------------------------------------------------
//      payload text
//         │  TextEncoder (UTF-8)
//         ▼
//      bytes ──▶ bitstream (MSB first per byte, zero-filled to fit)
//         │
//         ▼  group into slots of B bits, one slot per dial
//      slot levels (0 … 2ᴮ−1)
//         │  level × step        step = (θ:π/2 or φ:2π) / 2ᴮ
//         ▼
//      angles θ[q], φ[q]  ══[ stored state ]══▶  read back
//         │  round(angle / step) → level → B bits → bytes
//         ▼
//      recovered text  (compared to payload → exact / truncated badge)
//
//  CAPACITY
//      slots = n × (2 if θ used else 1) ;  register = slots × B bits.
//      Overflow past capBytes() is dropped and the badge turns rose.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      state / slots ........ "const S ="        n, bits, amp toggle, payload
//      slot list ............ "function slotList" dial order [θ,φ,θ,φ,…]
//      quantum step ......... "const stepFor"    angle per level
//      encode ............... "function encode"  bytes → angles
//      decode ............... "function decode"  angles → bytes
//      render ............... "function render"  encode, draw, decode, compare
//      dials ................ "function buildDials" per-qubit SVG dials
//      waveform ............. "function drawWave"  derived (decorative) spectrum
//      controls ............. "'payload').addEvent" inputs → state
// ============================================================================

// $ is the id lookup shorthand; TAU is one turn; S is the mutable state: qubit
// count, bits per angle, whether the θ (amplitude) dial is used, and the text.
const $=id=>document.getElementById(id);
const TAU=Math.PI*2;
const S={ n:10, bits:8, amp:true, payload:'Hello, Stella Nova!' };
// Dials per qubit: two (θ and φ) when amplitude storage is on, else one (φ).
const slotsPerQ=()=>S.amp?2:1;
// Total dials, and the byte capacity they hold at the current bit depth.
const numSlots=()=>S.n*slotsPerQ();
const capBytes=()=>Math.floor(numSlots()*S.bits/8);

/* build the flat slot list: for amp → [θ0,φ0,θ1,φ1,…]; phase → [φ0,φ1,…] */
function slotList(){const L=[];for(let j=0;j<S.n;j++){if(S.amp)L.push({type:'t',q:j});L.push({type:'p',q:j});}return L;}
// Angle per level: θ spans [0, π/2], φ spans [0, 2π], each split into 2ᴮ levels.
const stepFor=t=>(t==='t'?Math.PI/2:TAU)/(2**S.bits);

// The encoded register: per-qubit θ and φ arrays, plus how many payload bytes
// actually fit and whether the payload overflowed.
let STATE={th:[],ph:[],storedBytes:0,truncated:false};

// Turn the payload into stored angles: bytes → bitstream → slot levels → angles.
function encode(){
  // UTF-8 encode, then drop any bytes past capacity (flagged as truncated).
  const bytes=new TextEncoder().encode(S.payload);
  const cap=capBytes(),truncated=bytes.length>cap,used=Math.min(bytes.length,cap);
  // bitstream (MSB first per byte)
  const bits=[];for(let i=0;i<used;i++)for(let b=7;b>=0;b--)bits.push((bytes[i]>>b)&1);
  // Zero-fill the tail so every slot gets a full B-bit level.
  const slots=slotList();while(bits.length<slots.length*S.bits)bits.push(0);
  // Unused θ defaults to π/2 in phase-only mode so the dial reads full tilt.
  const th=Array(S.n).fill(S.amp?0:Math.PI/2), ph=Array(S.n).fill(0);
  // Pack B bits per slot into a level, scale to an angle, store on θ or φ.
  slots.forEach((s,si)=>{let lvl=0;for(let b=0;b<S.bits;b++)lvl=(lvl<<1)|bits[si*S.bits+b];
    const ang=lvl*stepFor(s.type);if(s.type==='t')th[s.q]=ang;else ph[s.q]=ang;});
  STATE={th,ph,storedBytes:used,truncated};
}
// Read the angles back into text: angle → nearest level → B bits → bytes.
function decode(){
  const slots=slotList(),bits=[];
  // Round each angle to its nearest level and clamp into the valid range.
  slots.forEach(s=>{const ang=(s.type==='t'?STATE.th[s.q]:STATE.ph[s.q]);
    let lvl=Math.round(ang/stepFor(s.type));lvl=Math.max(0,Math.min(2**S.bits-1,lvl));
    for(let b=S.bits-1;b>=0;b--)bits.push((lvl>>b)&1);});
  // Reassemble only the bytes that were actually stored.
  const out=new Uint8Array(STATE.storedBytes);
  for(let i=0;i<STATE.storedBytes;i++){let v=0;for(let b=0;b<8;b++)v=(v<<1)|bits[i*8+b];out[i]=v;}
  return new TextDecoder().decode(out);
}

/* ── render ── */
// Re-encode from the current controls, repaint every readout and both visuals,
// then decode and compare to report whether the round trip was exact.
function render(){
  encode();
  // Mirror the register controls and capacity numbers.
  $('n-val').textContent=S.n;$('b-val').textContent=S.bits;$('ampmode').classList.toggle('on',S.amp);
  const cap=capBytes(),used=STATE.storedBytes;
  $('capnum').textContent=used+' / '+cap+' bytes  ·  '+numSlots()+'×'+S.bits+' = '+(numSlots()*S.bits)+' bits';
  $('capfill').style.width=Math.min(100,cap?used/cap*100:0)+'%';
  // Contrast the simulator's 2nB bits with the Holevo n-bit hardware ceiling.
  $('holevo').innerHTML='simulator: '+(numSlots()*S.bits)+' bits · real hardware (Holevo): only <b>'+S.n+'</b> bits retrievable';
  // Bar turns rose when the payload overflowed, green when it fit.
  $('capfill').style.background=STATE.truncated?'var(--rose)':'var(--green)';
  $('reg-note').innerHTML=`<b>${numSlots()}</b> angle dials × <b>${S.bits}</b> bits = <b>${numSlots()*S.bits}</b> bits (${cap} bytes). `+(S.amp?'Each qubit carries a θ and a φ.':'Phase only — one φ per qubit.');
  $('slots-tag').textContent=numSlots()+' dials';
  buildDials();
  // Decode and compare: exact means the stored angles round-trip the payload.
  const dec=decode();
  $('decoded').textContent=dec||'∅';
  const exact=dec===S.payload;
  $('match').className='badge '+(exact?'ok':'warn');
  $('match').innerHTML=exact?'✓ exact round-trip — bytes recovered with zero loss'
    :(STATE.truncated?'✗ payload exceeds capacity — '+(S.payload.length-cap)+' byte(s) dropped. Add qubits or bits.':'✗ mismatch');
  drawWave();
}
// Draw one SVG dial per qubit (a Bloch-style readout). The needle points at φ;
// its distance from centre is r=13·sin(θ), and the ellipse height 13·cos(θ)
// shows the θ tilt toward or away from the viewer.
function buildDials(){const host=$('dials');host.innerHTML='';
  for(let j=0;j<S.n;j++){const th=STATE.th[j],ph=STATE.ph[j];
    // Needle tip: radius from θ, angle from φ (offset so 0 points up).
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
// Draw the decorative power spectrum of the stored rotations. It is a derived
// shadow of the angles, not the data itself; the meaning lives in the dials.
function drawWave(){const cv=$('cv-wave'),dpr=Math.min(devicePixelRatio||1,2),w=cv.clientWidth,h=cv.clientHeight;
  if(cv.width!==(w*dpr|0)||cv.height!==(h*dpr|0)){cv.width=w*dpr|0;cv.height=h*dpr|0;}
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  const N0=2**S.n,M=420,padL=10,padR=10,top=10,bot=h-18,plotW=w-padL-padR;
  // Closed-form spectrum: one factor per qubit built from its θ and φ.
  const spec=k=>{let p=1;for(let j=0;j<S.n;j++){const w2=TAU*2**j/N0;p*=1+Math.sin(2*STATE.th[j])*Math.cos(STATE.ph[j]-w2*k);}return p/N0;};
  // Sample the curve across the frequency axis and track its peak for scaling.
  let mx=1e-12;const P=new Float64Array(M+1);for(let i=0;i<=M;i++){P[i]=spec(i/M*N0);mx=Math.max(mx,P[i]);}
  const X=i=>padL+(i/M)*plotW,Y=v=>bot-(v/mx)*(bot-top);
  c.strokeStyle='rgba(90,130,180,0.09)';c.lineWidth=1;for(let g=0;g<=3;g++){const y=top+(bot-top)*g/3;c.beginPath();c.moveTo(padL,y);c.lineTo(w-padR,y);c.stroke();}
  c.beginPath();c.moveTo(padL,bot);for(let i=0;i<=M;i++)c.lineTo(X(i),Y(P[i]));c.lineTo(w-padR,bot);c.closePath();
  const grad=c.createLinearGradient(0,top,0,bot);grad.addColorStop(0,'rgba(168,156,255,0.30)');grad.addColorStop(1,'rgba(168,156,255,0.02)');c.fillStyle=grad;c.fill();
  c.strokeStyle='rgba(168,156,255,0.9)';c.lineWidth=1.4;c.beginPath();for(let i=0;i<=M;i++){const x=X(i),y=Y(P[i]);i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
  c.fillStyle='rgba(86,100,128,0.9)';c.font="9px 'JetBrains Mono'";c.textAlign='left';c.fillText('frequency k/N',padL,h-5);
}

/* ── controls ── */
// Each control writes into S and re-runs the whole encode/decode/draw cycle.
$('payload').addEventListener('input',e=>{S.payload=e.target.value;render();});
$('bits').addEventListener('input',e=>{S.bits=+e.target.value;render();});
// Toggle the θ (amplitude) axis, which halves or doubles the dial count.
$('ampmode').onclick=()=>{S.amp=!S.amp;render();};
// Qubit-count steppers, clamped to 1..20.
$('n-minus').onclick=()=>{S.n=Math.max(1,S.n-1);render();};
$('n-plus').onclick=()=>{S.n=Math.min(20,S.n+1);render();};
// The waveform is size-dependent, so redraw it on resize.
window.addEventListener('resize',drawWave);
// First paint.
render();
