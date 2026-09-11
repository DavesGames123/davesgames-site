"use strict";
/* ════════════════════════════════════════════════════════════
   Chord Chart — every root × 8 qualities, guitar & violin
   Shares the ChordLab shape library and renderers.
   GREP: guitarVoicings | ukeVoicings | drawFrettedInto | drawBassInto | drawViolinInto | strum
   ════════════════════════════════════════════════════════════ */
const NOTE_NAMES=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const pcColor=(pc,l=64)=>`hsl(${pc*30},88%,${l}%)`;
const pcColorA=(pc,a,l=64)=>`hsla(${pc*30},88%,${l}%,${a})`;

const QUALS={
  ''    :{iv:[0,4,7],    full:'major'},
  'm'   :{iv:[0,3,7],    full:'minor'},
  '7'   :{iv:[0,4,7,10], full:'dominant 7'},
  'maj7':{iv:[0,4,7,11], full:'major 7'},
  'm7'  :{iv:[0,3,7,10], full:'minor 7'},
  'sus2':{iv:[0,2,7],    full:'suspended 2'},
  'sus4':{iv:[0,5,7],    full:'suspended 4'},
  'dim' :{iv:[0,3,6],    full:'diminished'},
};
/* explicit order — Object.keys() sorts the integer-like '7' key first,
   which is why dominant-7 cards were jumping ahead of plain major */
const QUAL_BASIC=['','m','7'];
const QUAL_MORE=['maj7','m7','sus2','sus4','dim'];

/* ── guitar shapes (identical library to ChordLab) ── */
const OPEN_SHAPES={
  '0|':[-1,3,2,0,1,0],'9|':[-1,0,2,2,2,0],'7|':[3,2,0,0,0,3],'4|':[0,2,2,1,0,0],'2|':[-1,-1,0,2,3,2],
  '9|m':[-1,0,2,2,1,0],'4|m':[0,2,2,0,0,0],'2|m':[-1,-1,0,2,3,1],
  '9|7':[-1,0,2,0,2,0],'11|7':[-1,2,1,2,0,2],'0|7':[-1,3,2,3,1,0],'2|7':[-1,-1,0,2,1,2],'4|7':[0,2,0,1,0,0],'7|7':[3,2,0,0,0,1],
  '0|maj7':[-1,3,2,0,0,0],'9|maj7':[-1,0,2,1,2,0],'2|maj7':[-1,-1,0,2,2,2],'4|maj7':[0,2,1,1,0,0],'7|maj7':[3,2,0,0,0,2],'5|maj7':[-1,-1,3,2,1,0],
  '9|m7':[-1,0,2,0,1,0],'4|m7':[0,2,0,0,0,0],'2|m7':[-1,-1,0,2,1,1],
  '9|sus2':[-1,0,2,2,0,0],'2|sus2':[-1,-1,0,2,3,0],'7|sus2':[3,0,0,0,3,3],
  '9|sus4':[-1,0,2,2,3,0],'2|sus4':[-1,-1,0,2,3,3],'4|sus4':[0,2,2,2,0,0],
  '2|dim':[-1,-1,0,1,3,1],
};
const E_SHAPE={'':[0,2,2,1,0,0],'m':[0,2,2,0,0,0],'7':[0,2,0,1,0,0],'m7':[0,2,0,0,0,0],'maj7':[0,-1,1,1,0,-1],'sus4':[0,2,2,2,0,0],'sus2':null,'dim':null};
const A_SHAPE={'':[-1,0,2,2,2,0],'m':[-1,0,2,2,1,0],'7':[-1,0,2,0,2,0],'m7':[-1,0,2,0,1,0],'maj7':[-1,0,2,1,2,0],'sus4':[-1,0,2,2,3,0],'sus2':[-1,0,2,2,0,0],'dim':[-1,0,1,2,1,-1]};
const D_DIM=[-1,-1,0,1,3,1];
function barreAt(shape,f){return shape.map(v=>v<0?-1:v+f);}
function guitarVoicings(root,q){
  const out=[];
  const open=OPEN_SHAPES[root+'|'+q];
  if(open)out.push({name:'Open',frets:open,pos:0});
  const eF=((root-4)%12+12)%12, aF=((root-9)%12+12)%12;
  if(E_SHAPE[q]&&eF>=1&&eF<=11)out.push({name:eF+'fr',frets:barreAt(E_SHAPE[q],eF),barre:eF,pos:eF});
  if(A_SHAPE[q]&&aF>=1&&aF<=11)out.push({name:aF+'fr',frets:barreAt(A_SHAPE[q],aF),barre:aF,pos:aF});
  if(q==='dim'){const dF=((root-2)%12+12)%12;if(dF>=1&&dF<=11)out.push({name:dF+'fr',frets:barreAt(D_DIM,dF),pos:dF});}
  out.sort((a,b)=>a.pos-b.pos);   // easiest (lowest) voicing leads
  if(!out.length)out.push({name:'—',frets:[-1,-1,-1,-1,-1,-1]});
  return out;
}
const GTR_MIDI=[40,45,50,55,59,64];
const VLN_MIDI=[55,62,69,76], VLN_NAMES=['G','D','A','E'];
const UKE_MIDI=[67,60,64,69];               // g C E A, re-entrant
const BASS_MIDI=[28,33,38,43], BASS_NAMES=['E','A','D','G'];

/* ukulele voicing search — full coverage, 4-note chords may drop the 5th */
const _ukeCache=Object.create(null);
function ukeVoicings(root,q){
  const ck=root+'|'+q;
  if(_ukeCache[ck])return _ukeCache[ck];
  const need=(QUALS[q]||QUALS['']).iv.map(iv=>(root+iv)%12);
  const found=[];
  for(let base=0;base<=9;base++){
    const opts=UKE_MIDI.map(m=>{
      const o=[];
      for(let f=0;f<=base+3;f++){
        if(f!==0&&f<base)continue;
        if(need.includes((m+f)%12))o.push(f);
      }
      return o;
    });
    if(opts.some(o=>!o.length))continue;
    for(const f0 of opts[0])for(const f1 of opts[1])for(const f2 of opts[2])for(const f3 of opts[3]){
      const fr=[f0,f1,f2,f3];
      const pcs=new Set(fr.map((f,st)=>(UKE_MIDI[st]+f)%12));
      let ok=need.every(pc=>pcs.has(pc)),dropped5=false;
      if(!ok&&need.length===4){ok=need.every((pc,i)=>i===2||pcs.has(pc));dropped5=ok;}
      if(!ok)continue;
      const pos=fr.filter(f=>f>0);
      const lo=pos.length?Math.min(...pos):0,hi=pos.length?Math.max(...pos):0;
      if(hi-lo>3)continue;
      found.push({frets:fr,base:lo,score:fr.reduce((a,b)=>a+b,0)+hi*0.6+(dropped5?2.5:0)});
    }
  }
  found.sort((a,b)=>a.score-b.score);
  const seen=new Set(),out=[];
  for(const v of found){
    const k=v.frets.join(',');
    if(seen.has(k))continue;seen.add(k);
    out.push({name:v.base===0?'Open':v.base+'fr',frets:v.frets});
    if(out.length>=3)break;
  }
  if(!out.length)out.push({name:'—',frets:[-1,-1,-1,-1]});
  return _ukeCache[ck]=out;
}

/* bass: chord-tone map — bassists outline, so show every tone position */
function drawBassInto(cv,root,q){
  const P=prep(cv);if(!P)return;const{x,w,h}=P;
  const tones=new Set();(QUALS[q]||QUALS['']).iv.forEach(iv=>tones.add((root+iv)%12));
  const pad={t:34,b:34,l:38,r:22},NF=5;
  const gw=w-pad.l-pad.r,gh=h-pad.t-pad.b;
  const sx=i=>pad.l+gw*i/3, fy=f=>pad.t+gh*f/NF;
  for(let f=0;f<=NF;f++){
    x.strokeStyle=f===0?'rgba(232,236,244,0.9)':'rgba(150,200,255,0.16)';
    x.lineWidth=f===0?4:1;
    x.beginPath();x.moveTo(pad.l,fy(f));x.lineTo(pad.l+gw,fy(f));x.stroke();
  }
  x.font='500 9px "JetBrains Mono",monospace';
  x.fillStyle='rgba(128,144,176,0.7)';x.textAlign='right';x.textBaseline='middle';
  for(let f=1;f<=NF;f++)x.fillText(f,pad.l-8,fy(f-0.5));
  x.textBaseline='alphabetic';x.textAlign='center';
  for(let st=0;st<4;st++){
    x.strokeStyle='rgba(150,200,255,0.32)';x.lineWidth=3.2-st*0.65;
    x.beginPath();x.moveTo(sx(st),fy(0));x.lineTo(sx(st),fy(NF));x.stroke();
    x.font='700 10px "JetBrains Mono",monospace';
    x.fillStyle='rgba(128,144,176,0.85)';
    x.fillText(BASS_NAMES[st],sx(st),fy(NF)+18);
  }
  const dR=Math.min(11.5,gw/9);
  for(let st=0;st<4;st++)for(let f=0;f<=NF;f++){
    const pc=(BASS_MIDI[st]+f)%12;
    if(!tones.has(pc))continue;
    const isRoot=pc===root,X=sx(st);
    if(f===0){
      x.strokeStyle=pcColor(pc,66);x.lineWidth=2;
      x.beginPath();x.arc(X,fy(0)-12,5.5,0,7);x.stroke();
      if(isRoot){x.strokeStyle=pcColorA(pc,0.45);x.beginPath();x.arc(X,fy(0)-12,9,0,7);x.stroke();}
    }else{
      const y=fy(f-0.5);
      x.fillStyle=pcColor(pc,60);
      x.shadowColor=pcColorA(pc,0.7);x.shadowBlur=isRoot?13:8;
      x.beginPath();x.arc(X,y,isRoot?dR+1:dR-1.5,0,7);x.fill();x.shadowBlur=0;
      if(isRoot){x.strokeStyle='rgba(255,255,255,0.85)';x.lineWidth=1.4;x.beginPath();x.arc(X,y,dR+3.5,0,7);x.stroke();}
      x.fillStyle='#0e1118';
      x.font='700 9px "JetBrains Mono",monospace';x.textAlign='center';x.textBaseline='middle';
      x.fillText(NOTE_NAMES[pc].replace('♯','#'),X,y+0.5);
      x.textBaseline='alphabetic';
    }
  }
}

/* ── renderers into an arbitrary canvas ── */
function prep(cv){
  const dpr=Math.min(devicePixelRatio||1,2);
  const w=cv.clientWidth,h=cv.clientHeight;
  if(w<10||h<10)return null;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=w*dpr;cv.height=h*dpr;}
  const x=cv.getContext('2d');
  x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  return {x,w,h};
}
function drawFrettedInto(cv,root,q,MIDI){
  const NS=MIDI.length;
  const P=prep(cv);if(!P)return;const{x,w,h}=P;
  const vs=(MIDI===UKE_MIDI?ukeVoicings:guitarVoicings)(root,q), v=vs[0], frets=v.frets;
  const played=frets.filter(f=>f>=0);
  const fMax=played.length?Math.max(...played):3;
  const fMinPos=played.filter(f=>f>0);
  const fMin=fMinPos.length?Math.min(...fMinPos):0;
  const base=fMax<=4?0:Math.max(1,fMin);
  const nFrets=Math.max(5,fMax-base+(base>0?1:0));
  const pad={t:44,b:36,l:34,r:24};
  const gw=w-pad.l-pad.r,gh=h-pad.t-pad.b;
  const sx=i=>pad.l+gw*i/(NS-1), fy=f=>pad.t+gh*f/nFrets;
  // strings
  for(let s=0;s<NS;s++){x.strokeStyle='rgba(150,200,255,0.3)';x.lineWidth=0.8+s*0.25;
    x.beginPath();x.moveTo(sx(s),pad.t);x.lineTo(sx(s),pad.t+gh);x.stroke();}
  // frets
  for(let f=0;f<=nFrets;f++){
    x.strokeStyle=f===0&&base===0?'rgba(232,236,244,0.9)':'rgba(150,200,255,0.18)';
    x.lineWidth=f===0&&base===0?4:1.1;
    x.beginPath();x.moveTo(pad.l,fy(f));x.lineTo(pad.l+gw,fy(f));x.stroke();
  }
  if(base>0){x.font='600 11px "JetBrains Mono",monospace';x.fillStyle='#8090b0';x.textAlign='right';x.fillText(base+'fr',pad.l-8,fy(0.5)+4);}
  // barre band — only across the strings actually fretted at the barre
  if(v.barre&&base>0){
    const barred=frets.map((f,s)=>f===v.barre?s:-1).filter(s=>s>=0);
    if(barred.length>1){
      const y=fy(v.barre-base+0.5), x0=sx(Math.min(...barred)), x1=sx(Math.max(...barred));
      x.fillStyle=pcColorA(root,0.22,50);
      x.beginPath();
      if(x.roundRect)x.roundRect(x0-11,y-10,x1-x0+22,20,10);else x.rect(x0-11,y-10,x1-x0+22,20);
      x.fill();
    }
  }
  const dR=Math.min(12.5,gw/12);
  x.textAlign='center';
  for(let s=0;s<NS;s++){
    const f=frets[s],X=sx(s);
    if(f<0){x.font='700 13px "JetBrains Mono",monospace';x.fillStyle='rgba(224,80,80,0.85)';x.fillText('✕',X,pad.t-11);continue;}
    const pc=(MIDI[s]+f)%12;
    if(f===0){x.strokeStyle=pcColor(pc,66);x.lineWidth=2.2;x.beginPath();x.arc(X,pad.t-15,6.5,0,7);x.stroke();}
    else{
      const y=fy(f-base-0.5+(base>0?1:0));
      x.fillStyle=pcColor(pc,60);
      x.shadowColor=pcColorA(pc,0.7);x.shadowBlur=11;
      x.beginPath();x.arc(X,y,dR,0,7);x.fill();x.shadowBlur=0;
      x.fillStyle='#0e1118';x.font='700 10px "JetBrains Mono",monospace';x.textBaseline='middle';
      x.fillText(NOTE_NAMES[pc].replace('♯','#'),X,y+0.5);x.textBaseline='alphabetic';
    }
  }
  // note letters under each string
  x.font='500 10px "JetBrains Mono",monospace';
  for(let s=0;s<NS;s++){
    const f=frets[s];
    if(f<0){x.fillStyle='rgba(80,96,128,0.6)';x.fillText('—',sx(s),pad.t+gh+22);}
    else{const pc=(MIDI[s]+f)%12;x.fillStyle=pcColor(pc,62);x.fillText(NOTE_NAMES[pc],sx(s),pad.t+gh+22);}
  }
}
function drawViolinInto(cv,root,q){
  const P=prep(cv);if(!P)return;const{x,w,h}=P;
  const tones=new Set();(QUALS[q]||QUALS['']).iv.forEach(iv=>tones.add((root+iv)%12));
  const pad={t:36,b:34,l:44,r:44};
  const gw=w-pad.l-pad.r,gh=h-pad.t-pad.b;
  const sx=i=>pad.l+gw*i/3, NPOS=7, py=st=>pad.t+gh*st/NPOS;
  // nut
  x.strokeStyle='rgba(232,236,244,0.85)';x.lineWidth=4;
  x.beginPath();x.moveTo(pad.l-18,pad.t);x.lineTo(pad.l+gw+18,pad.t);x.stroke();
  // semitone guides
  for(let st=1;st<=NPOS;st++){x.strokeStyle='rgba(150,200,255,0.08)';x.lineWidth=1;
    x.beginPath();x.moveTo(pad.l-18,py(st));x.lineTo(pad.l+gw+18,py(st));x.stroke();}
  x.textAlign='center';
  for(let s=0;s<4;s++){
    x.strokeStyle='rgba(150,200,255,0.3)';x.lineWidth=2.4-s*0.45;
    x.beginPath();x.moveTo(sx(s),pad.t);x.lineTo(sx(s),pad.t+gh);x.stroke();
    x.font='700 11px "JetBrains Mono",monospace';x.fillStyle='rgba(128,144,176,0.85)';
    x.fillText(VLN_NAMES[s],sx(s),pad.t+gh+21);
  }
  const dR=Math.min(12,gw/9);
  for(let s=0;s<4;s++)for(let st=0;st<=NPOS;st++){
    const pc=(VLN_MIDI[s]+st)%12;
    if(!tones.has(pc))continue;
    const isRoot=pc===root,X=sx(s);
    if(st===0){x.strokeStyle=pcColor(pc,66);x.lineWidth=2.2;x.beginPath();x.arc(X,pad.t-13,6.5,0,7);x.stroke();}
    else{
      const y=py(st);
      x.fillStyle=pcColor(pc,60);
      x.shadowColor=pcColorA(pc,0.7);x.shadowBlur=isRoot?14:9;
      x.beginPath();x.arc(X,y,isRoot?dR+1:dR-1,0,7);x.fill();x.shadowBlur=0;
      if(isRoot){x.strokeStyle='rgba(255,255,255,0.85)';x.lineWidth=1.5;x.beginPath();x.arc(X,y,dR+4,0,7);x.stroke();}
      x.fillStyle='#0e1118';x.font='700 10px "JetBrains Mono",monospace';x.textBaseline='middle';
      x.fillText(NOTE_NAMES[pc].replace('♯','#'),X,y+0.5);x.textBaseline='alphabetic';
    }
  }
}

/* ── strum synth ── */
let AC=null;
function strum(root,q){
  if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
  if(AC.state==='suspended')AC.resume();
  let midis=[],stag=0.055,dur=2.4;
  if(instrument==='guitar'||instrument==='ukulele'){
    const MIDI=instrument==='guitar'?GTR_MIDI:UKE_MIDI;
    const vf=instrument==='guitar'?guitarVoicings:ukeVoicings;
    vf(root,q)[0].frets.forEach((f,st)=>{if(f>=0)midis.push(MIDI[st]+f);});
  }else if(instrument==='bass'){
    const base=28+((root-4)%12+12)%12;
    midis=[base,base+7,base+12];stag=0.22;dur=2.9;
  }else{
    midis=(QUALS[q]||QUALS['']).iv.map(iv=>60+((root+iv)%12)+((root+iv)>=12?12:0));
    midis.unshift(48+root);
  }
  const t0=AC.currentTime+0.03;
  const master=AC.createGain();master.gain.value=0.5;master.connect(AC.destination);
  midis.forEach((mn,i)=>{
    const f=440*Math.pow(2,(mn-69)/12), t=t0+i*stag;
    const o1=AC.createOscillator(),o2=AC.createOscillator(),g=AC.createGain(),g2=AC.createGain();
    o1.type='triangle';o1.frequency.value=f;
    o2.type='sine';o2.frequency.value=f*2;o2.detune.value=4;g2.gain.value=0.18;
    o1.connect(g);o2.connect(g2);g2.connect(g);g.connect(master);
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(0.34/Math.sqrt(midis.length),t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    o1.start(t);o2.start(t);o1.stop(t+dur+0.1);o2.stop(t+dur+0.1);
  });
}

/* ── UI state ── */
let root=0, instrument='guitar';
const $=id=>document.getElementById(id);

/* root strip */
const strip=$('rootStrip');
for(let pc=0;pc<12;pc++){
  const b=document.createElement('button');
  b.className='rchip';b.textContent=NOTE_NAMES[pc];
  b.style.color=pcColor(pc,66);b.style.borderColor=pcColorA(pc,0.55);
  b.addEventListener('click',()=>{root=pc;syncStrip();renderGrid();});
  strip.appendChild(b);
}
function syncStrip(){
  [...strip.children].forEach((b,pc)=>{
    const on=pc===root;
    b.classList.toggle('on',on);
    b.style.background=on?pcColorA(pc,0.22,40):'rgba(0,0,0,0.3)';
    b.style.boxShadow=on?`0 0 18px ${pcColorA(pc,0.55)}`:'none';
  });
  const br=$('bigRoot');
  br.textContent=NOTE_NAMES[root];
  br.style.color=pcColor(root,68);
  br.style.textShadow=`0 0 26px ${pcColorA(root,0.55)}`;
  $('st-root').textContent=NOTE_NAMES[root];
}

/* instrument seg */
$('instSeg').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  [...$('instSeg').children].forEach(x=>x.classList.remove('on'));
  b.classList.add('on');instrument=b.dataset.i;
  $('st-inst').textContent=instrument;
  renderGrid();
});

/* quality grid */
function drawCard(cv,root,q){
  if(instrument==='guitar')drawFrettedInto(cv,root,q,GTR_MIDI);
  else if(instrument==='ukulele')drawFrettedInto(cv,root,q,UKE_MIDI);
  else if(instrument==='bass')drawBassInto(cv,root,q);
  else drawViolinInto(cv,root,q);
}
function fillGrid(id,quals){
  const g=$(id);g.innerHTML='';
  for(const q of quals){
    const card=document.createElement('div');
    card.className='qcard';
    card.style.borderColor=pcColorA(root,0.28);
    card.innerHTML=`
      <div class="qname" style="color:${pcColor(root,66)}">${NOTE_NAMES[root]}${q}</div>
      <div class="qfull">${QUALS[q].full}</div>
      <canvas></canvas>
      <button class="playb" title="Hear ${NOTE_NAMES[root]}${q}">♪</button>`;
    card.addEventListener('mouseenter',()=>card.style.boxShadow=`0 6px 26px ${pcColorA(root,0.22)}`);
    card.addEventListener('mouseleave',()=>card.style.boxShadow='none');
    card.querySelector('.playb').addEventListener('click',e=>{e.stopPropagation();strum(root,q);});
    card.addEventListener('click',()=>strum(root,q));
    g.appendChild(card);
    const cv=card.querySelector('canvas');
    requestAnimationFrame(()=>drawCard(cv,root,q));
  }
}
function renderGrid(){
  fillGrid('gridBasic',QUAL_BASIC);
  fillGrid('gridMore',QUAL_MORE);
}

let rT=null;
window.addEventListener('resize',()=>{clearTimeout(rT);rT=setTimeout(renderGrid,150);});
syncStrip();renderGrid();
