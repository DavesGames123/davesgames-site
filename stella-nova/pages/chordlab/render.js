/* ═══════════ LOOK — fonts and colours shared by every canvas ═══════════
   Diagrams use one style for every instrument: hairline grid, the chord root as a
   coloured dot with a halo, the other chord tones as light dots, and
   numbers or note names inside the dots. Fonts follow style.css. */
const F_SANS='Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
const F_SERIF='"STIX Two Text",Georgia,"Times New Roman",serif';
const F_MONO='ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const UI={bg:'#0b0d12',ink:'#eceff4',ink2:'#b8bfcc',dim:'#8a92a0',faint:'#596171',
  line:'rgba(255,255,255,0.12)',grid:'rgba(255,255,255,0.22)',ok:'#5fd38a',bad:'#ff6b6b'};
// Interval names, by semitones above the root.
const DEG_NAMES=['R','♭2','2','♭3','3','4','♭5','5','♯5','6','♭7','7'];
// Note name with an ASCII sharp, for small labels inside dots.
const shortName=pc=>NOTE_NAMES[pc].replace('♯','#');

/* ═══════════ CHROMA RING ═══════════ */
// The wheel behind the chord name: 12 wedges, one per pitch class, each growing
// outward with its chroma energy. Tones of the current chord are lit and ringed.
const ringC=$('ringCanvas'),ringX=ringC.getContext('2d');
// Per-wedge smoothed height so wedges ease rather than jump between frames.
let ringPulse=new Float32Array(12);
function drawRing(){
  // Match the backing store to CSS size at device pixel ratio (capped at 2).
  const dpr=Math.min(devicePixelRatio||1,2);
  const w=ringC.clientWidth,h=ringC.clientHeight;
  if(w<10||h<10)return;
  if(ringC.width!==w*dpr){ringC.width=w*dpr;ringC.height=h*dpr;}
  ringX.setTransform(dpr,0,0,dpr,0,0);
  ringX.clearRect(0,0,w,h);
  const cx=w/2,cy=h/2;
  const R1=Math.min(w,h)*0.335;              // inner radius
  const RMAX=Math.min(w,h)*0.475;            // max outer
  // Collect the pitch classes belonging to the current chord (or lone note).
  const chordPCs=new Set();
  if(curChord&&QUALS[curChord.q])QUALS[curChord.q].iv.forEach(iv=>chordPCs.add((curChord.root+iv)%12));
  if(curChord&&curChord.q==='·note')chordPCs.add(curChord.root);
  for(let pc=0;pc<12;pc++){
    // Ease each wedge toward chroma*level; the 2.2 gain exaggerates weak tones.
    ringPulse[pc]+=(chroma[pc]*level*2.2-ringPulse[pc])*0.3;
    const v=Math.min(1,ringPulse[pc]);
    // Wedge angular span: C at top (-90 deg), 30 deg per pitch class, 0.42 of a
    // slot half-width leaves a gap between wedges. Outer radius grows with v.
    const a0=-Math.PI/2+(pc-0.42)*Math.PI/6, a1=-Math.PI/2+(pc+0.42)*Math.PI/6;
    const R2=R1+6+(RMAX-R1-6)*v;
    const inChord=chordPCs.has(pc);
    // wedge
    ringX.beginPath();
    ringX.arc(cx,cy,R2,a0,a1);
    ringX.arc(cx,cy,R1,a1,a0,true);
    ringX.closePath();
    ringX.fillStyle=pcColorA(pc,inChord?0.28+v*0.6:0.10+v*0.42,inChord?62:52);
    ringX.fill();
    if(inChord){
      ringX.strokeStyle=pcColorA(pc,0.9);ringX.lineWidth=1.6;
      ringX.stroke();
      ringX.shadowColor=pcColor(pc);ringX.shadowBlur=14;
      ringX.stroke();ringX.shadowBlur=0;
    }
    // note label
    const am=(a0+a1)/2, LR=R1-14;
    ringX.font=(inChord?'600 ':'400 ')+'11px '+F_SANS;
    ringX.fillStyle=inChord?pcColor(pc,74):'rgba(138,146,160,0.6)';
    ringX.textAlign='center';ringX.textBaseline='middle';
    ringX.fillText(NOTE_NAMES[pc],cx+Math.cos(am)*LR,cy+Math.sin(am)*LR);
  }
  // faint inner circle
  ringX.beginPath();ringX.arc(cx,cy,R1,0,7);
  ringX.strokeStyle='rgba(255,255,255,0.08)';ringX.lineWidth=1;ringX.stroke();
}

/* ════════════════════════════════════════════════════════════
   GUITAR & VIOLIN DIAGRAMS
   ════════════════════════════════════════════════════════════ */
// Which instrument the right panel draws, and which chord/voicing it shows.
// diagDirty flags the canvas for a repaint on the next loop iteration.
let instrument='guitar';
let diagChord={root:0,q:''};   // what's drawn on the right
let voicingIdx=0;
let diagDirty=true;

// Instrument selector: switch the active instrument and rebuild its voicings.
$('instSeg').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  [...$('instSeg').children].forEach(x=>x.classList.remove('on'));
  b.classList.add('on');instrument=b.dataset.i;diagDirty=true;buildVoicingBtns();
});
// Set the diagram's chord, resetting to its first voicing. Skips redundant work
// when the chord has not changed, so a held chord does not thrash the diagram.
function setDiagramChord(root,q){
  if(diagChord.root===root&&diagChord.q===q)return;
  diagChord={root,q};voicingIdx=0;diagDirty=true;buildVoicingBtns();
}

/* ── guitar voicing library ──
   shape: 6 frets low-E→high-e, -1 = mute. */
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
// Movable barre shapes rooted on the low E and A strings (open-position forms
// at fret 0). Sliding one up by f frets transposes it, giving every root.
const E_SHAPE={'':[0,2,2,1,0,0],'m':[0,2,2,0,0,0],'7':[0,2,0,1,0,0],'m7':[0,2,0,0,0,0],'maj7':[0,-1,1,1,0,-1],'sus4':[0,2,2,2,0,0],'sus2':null,'dim':null};
const A_SHAPE={'':[-1,0,2,2,2,0],'m':[-1,0,2,2,1,0],'7':[-1,0,2,0,2,0],'m7':[-1,0,2,0,1,0],'maj7':[-1,0,2,1,2,0],'sus4':[-1,0,2,2,3,0],'sus2':[-1,0,2,2,0,0],'dim':[-1,0,1,2,1,-1]};
const D_DIM=[-1,-1,0,1,3,1]; // movable dim rooted on D string
// Transpose a shape up f frets, leaving muted strings (-1) muted.
function barreAt(shape,f){return shape.map(v=>v<0?-1:v+f);}
// Assemble the playable voicings for a guitar chord: the open form if one exists
// plus movable E-shape and A-shape barres, ordered lowest position first.
function guitarVoicings(root,q){
  const out=[];
  const open=OPEN_SHAPES[root+'|'+q];
  if(open)out.push({name:'Open',frets:open,pos:0});
  // Barre fret = distance from the shape's home root (E=4, A=9) to this root.
  const eF=((root-4)%12+12)%12, aF=((root-9)%12+12)%12;
  if(E_SHAPE[q]&&eF>=1&&eF<=11)out.push({name:eF+'fr · E-shape',frets:barreAt(E_SHAPE[q],eF),barre:eF,pos:eF});
  if(A_SHAPE[q]&&aF>=1&&aF<=11)out.push({name:aF+'fr · A-shape',frets:barreAt(A_SHAPE[q],aF),barre:aF,pos:aF});
  if(q==='dim'){const dF=((root-2)%12+12)%12;if(dF>=1&&dF<=11)out.push({name:dF+'fr · dim',frets:barreAt(D_DIM,dF),pos:dF});}
  out.sort((a,b)=>a.pos-b.pos);   // lowest playable position leads
  if(!out.length)out.push({name:'—',frets:[-1,-1,-1,-1,-1,-1]});
  return out;
}
// Build the row of voicing-picker buttons for the current chord and wire each
// to select its voicing. Only guitar and ukulele have selectable voicings.
function buildVoicingBtns(){
  const el=$('voicings');
  if(instrument!=='guitar'&&instrument!=='ukulele'){el.innerHTML='';return;}
  const vs=voicingsFor(diagChord.root,diagChord.q);
  if(voicingIdx>=vs.length)voicingIdx=0;
  el.innerHTML=vs.map((v,i)=>`<button class="vbtn${i===voicingIdx?' on':''}" data-v="${i}">${v.name}</button>`).join('');
  [...el.children].forEach(b=>b.addEventListener('click',()=>{voicingIdx=+b.dataset.v;diagDirty=true;buildVoicingBtns();}));
}

// Open-string MIDI pitches per instrument, low string first. These map a
// (string, fret) pair to a pitch class as (MIDI+fret)%12 throughout the diagrams.
const GTR_MIDI=[40,45,50,55,59,64];
const UKE_MIDI=[67,60,64,69];            // g C E A — re-entrant high-g
const BASS_MIDI=[28,33,38,43], BASS_NAMES=['E','A','D','G'];

// Dispatch to the right voicing generator for the active instrument.
function voicingsFor(root,q){
  return instrument==='ukulele'?ukeVoicings(root,q):guitarVoicings(root,q);
}

/* ── ukulele: exhaustive first-positions search ──
   4 strings, window of 4 frets; full chord-tone coverage required,
   except 4-note chords may drop the 5th (standard uke practice). */
// Memoize results by "root|quality"; the search below is exhaustive.
const _ukeCache=Object.create(null);
function ukeVoicings(root,q){
  const ck=root+'|'+q;
  if(_ukeCache[ck])return _ukeCache[ck];
  // The pitch classes this chord must contain.
  const need=(QUALS[q]||QUALS['']).iv.map(iv=>(root+iv)%12);
  const found=[];
  // Slide a 4-fret window up the neck; at each base position enumerate, per
  // string, the frets in reach that land on a needed chord tone.
  for(let base=0;base<=9;base++){
    const opts=UKE_MIDI.map(m=>{
      const o=[];
      for(let f=0;f<=base+3;f++){
        if(f!==0&&f<base)continue;
        if(need.includes((m+f)%12))o.push(f);
      }
      return o;
    });
    // If any string can reach no chord tone, this base yields no voicing.
    if(opts.some(o=>!o.length))continue;
    // Cartesian product of the per-string options: every candidate fingering.
    for(const f0 of opts[0])for(const f1 of opts[1])for(const f2 of opts[2])for(const f3 of opts[3]){
      const fr=[f0,f1,f2,f3];
      const pcs=new Set(fr.map((f,st)=>(UKE_MIDI[st]+f)%12));
      // Require full chord-tone coverage.
      let ok=need.every(pc=>pcs.has(pc));
      let dropped5=false;
      // 4-note chords may omit the 5th (index 2), standard on 4 strings.
      if(!ok&&need.length===4){
        ok=need.every((pc,idx)=>idx===2||pcs.has(pc));
        dropped5=ok;
      }
      if(!ok)continue;
      // Reject spans wider than 4 frets; score favors low, tight, complete shapes.
      const pos=fr.filter(f=>f>0);
      const lo=pos.length?Math.min(...pos):0, hi=pos.length?Math.max(...pos):0;
      if(hi-lo>3)continue;
      found.push({frets:fr,base:lo,score:fr.reduce((a,b)=>a+b,0)+hi*0.6+(dropped5?2.5:0)});
    }
  }
  // Easiest first, then keep up to 3 distinct fingerings.
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

/* ── bass: chord-tone map, first 5 frets ──
   Bassists outline chords, so show every chord tone position;
   root coloured — walk root → 5th → octave from any of them. */
function drawBass(){
  if(!fitDiag())return;
  const w=diagC.clientWidth,h=diagC.clientHeight;
  diagX.clearRect(0,0,w,h);
  const tones=chordTones();
  const pad={t:76,b:40,l:50,r:30}, NF=5;
  const gw=w-pad.l-pad.r,gh=h-pad.t-pad.b;
  const sx=i=>pad.l+gw*i/3, fy=f=>pad.t+gh*f/NF;
  diagTitle(w,'Chord tones in the first five frets');
  fretInlays(sx(1),sx(2),fy,0,NF);
  fretGrid(pad.l,pad.l+gw,fy,NF,true);
  for(let st=0;st<4;st++)stringLine(sx(st),fy(0),fy(NF),2.6-st*0.45);
  fretNumbers(pad.l,fy,0,NF);
  const dR=Math.min(12,gw/9);
  for(let st=0;st<4;st++){
    for(let f=0;f<=NF;f++){
      const pc=(BASS_MIDI[st]+f)%12;
      if(!tones.has(pc))continue;
      if(f===0)openRing(sx(st),fy(0)-15,pc);
      else noteDot(sx(st),fy(f-0.5),dR,pc,shortName(pc));
    }
    stringLabel(sx(st),h-pad.b+24,BASS_NAMES[st]);
  }
}

// Route to the drawing routine for the active instrument.
function redrawDiagram(){
  if(instrument==='guitar')drawChordBox(GTR_MIDI);
  else if(instrument==='ukulele')drawChordBox(UKE_MIDI);
  else if(instrument==='bass')drawBass();
  else if(instrument==='piano')drawPiano();
  else drawViolin();
}

const diagC=$('diagCanvas'),diagX=diagC.getContext('2d');
// Size the diagram canvas backing store to its CSS box at device pixel ratio
// (up to 3, so the thin lines stay sharp on phones). Returns false when the
// element is collapsed (for example a hidden mobile tab).
function fitDiag(){
  const dpr=Math.min(devicePixelRatio||1,3);
  const w=diagC.clientWidth,h=diagC.clientHeight;
  if(w<10||h<10)return false;
  if(diagC.width!==Math.round(w*dpr)||diagC.height!==Math.round(h*dpr)){diagC.width=Math.round(w*dpr);diagC.height=Math.round(h*dpr);}
  diagX.setTransform(dpr,0,0,dpr,0,0);
  return true;
}
// The chord name shown above each diagram.
function chordTitle(){return NOTE_NAMES[diagChord.root]+diagChord.q;}
// The pitch classes of the diagram chord.
function chordTones(){
  const s=new Set();
  (QUALS[diagChord.q]||QUALS['']).iv.forEach(iv=>s.add((diagChord.root+iv)%12));
  return s;
}
// Chord name (serif, root hue) and a one-line caption under it.
function diagTitle(w,sub){
  diagX.textAlign='center';diagX.textBaseline='alphabetic';
  diagX.font='500 27px '+F_SERIF;
  diagX.fillStyle=pcColor(diagChord.root,74);
  diagX.fillText(chordTitle(),w/2,30);
  if(sub){diagX.font='400 11px '+F_SANS;diagX.fillStyle=UI.dim;diagX.fillText(sub,w/2,48);}
}
// Snap a 1 px line to the pixel grid.
const px=v=>Math.round(v)+0.5;
// Fret lines; a nut (thick bar) on top when the window starts at fret 0.
function fretGrid(x0,x1,fy,n,nut){
  diagX.lineCap='butt';
  for(let f=nut?1:0;f<=n;f++){
    diagX.strokeStyle=UI.grid;diagX.lineWidth=1;
    diagX.beginPath();diagX.moveTo(x0,px(fy(f)));diagX.lineTo(x1,px(fy(f)));diagX.stroke();
  }
  if(nut){
    diagX.fillStyle='#dfe3ea';
    diagX.beginPath();
    if(diagX.roundRect)diagX.roundRect(x0-2,fy(0)-4,x1-x0+4,6,2);else diagX.rect(x0-2,fy(0)-4,x1-x0+4,6);
    diagX.fill();
  }
}
function stringLine(x,y0,y1,lw){
  diagX.strokeStyle='rgba(236,239,244,0.42)';diagX.lineWidth=lw;
  diagX.beginPath();diagX.moveTo(x,y0);diagX.lineTo(x,y1);diagX.stroke();
}
// Inlay dots (frets 3 5 7 9, double at 12) between the middle strings.
function fretInlays(xa,xb,fy,base,n){
  diagX.fillStyle='rgba(255,255,255,0.06)';
  for(let i=1;i<=n;i++){
    const fr=base+i, y=fy(i-0.5);
    if(fr===12){
      [xa,xb].forEach(x=>{diagX.beginPath();diagX.arc(x,y,4,0,7);diagX.fill();});
    }else if(fr===3||fr===5||fr===7||fr===9||fr===15){
      diagX.beginPath();diagX.arc((xa+xb)/2,y,4.5,0,7);diagX.fill();
    }
  }
}
// Fret numbers down the left side of a nut-anchored grid.
function fretNumbers(x,fy,base,n){
  diagX.font='500 10px '+F_MONO;diagX.fillStyle=UI.faint;
  diagX.textAlign='right';diagX.textBaseline='middle';
  for(let f=1;f<=n;f++)diagX.fillText(String(base+f),x-20,fy(f-0.5));
  diagX.textBaseline='alphabetic';
}
// One chord-tone dot: the root in its hue with a halo, the others light.
function noteDot(x,y,r,pc,label){
  const isRoot=pc===diagChord.root;
  if(isRoot){
    diagX.fillStyle=pcColorA(pc,0.22,60);
    diagX.beginPath();diagX.arc(x,y,r+4,0,7);diagX.fill();
  }
  diagX.fillStyle=isRoot?pcColor(pc,62):'#e6e9ef';
  diagX.beginPath();diagX.arc(x,y,r,0,7);diagX.fill();
  if(label){
    diagX.fillStyle=isRoot?'#07080c':'#14171f';
    diagX.font='600 '+Math.max(9,Math.round(r*0.92))+'px '+F_SANS;
    diagX.textAlign='center';diagX.textBaseline='middle';
    diagX.fillText(label,x,y+0.5);
    diagX.textBaseline='alphabetic';
  }
}
// An open string above the nut: a ring, filled faintly when it is the root.
function openRing(x,y,pc){
  const isRoot=pc===diagChord.root;
  diagX.lineWidth=1.8;
  diagX.strokeStyle=isRoot?pcColor(pc,66):'rgba(236,239,244,0.8)';
  if(isRoot){diagX.fillStyle=pcColorA(pc,0.22,60);diagX.beginPath();diagX.arc(x,y,6,0,7);diagX.fill();}
  diagX.beginPath();diagX.arc(x,y,6,0,7);diagX.stroke();
}
// A muted string above the nut: a small cross.
function muteMark(x,y){
  diagX.strokeStyle='rgba(255,107,107,0.85)';diagX.lineWidth=1.7;diagX.lineCap='round';
  diagX.beginPath();diagX.moveTo(x-4.5,y-4.5);diagX.lineTo(x+4.5,y+4.5);diagX.moveTo(x+4.5,y-4.5);diagX.lineTo(x-4.5,y+4.5);diagX.stroke();
  diagX.lineCap='butt';
}
function stringLabel(x,y,t,col){
  diagX.font='600 11px '+F_SANS;diagX.fillStyle=col||UI.dim;
  diagX.textAlign='center';diagX.textBaseline='alphabetic';
  diagX.fillText(t,x,y);
}

/* ── finger numbers ──
   A fixed rule that gives the usual fingering for the voicing library:
   the barre fret is finger 1; the other fretted notes take the next
   fingers, lowest fret first and low string first on one fret. Capped
   at 4. Gives C 3-2-1, D 1-3-2, E 2-3-1, Am 2-3-1, F (E-shape) 1-3-4-2-1-1. */
function fingerFor(frets,barre){
  const fing=frets.map(()=>0);
  let next=1;
  if(barre){frets.forEach((f,s)=>{if(f===barre)fing[s]=1;});next=2;}
  const order=frets.map((f,s)=>({f,s})).filter(o=>o.f>0&&!fing[o.s]).sort((a,b)=>a.f-b.f||a.s-b.s);
  for(const o of order)fing[o.s]=Math.min(4,next++);
  return fing;
}

// Standard vertical chord box for guitar or ukulele: strings as columns, frets
// as rows, one voicing as numbered finger dots, open rings and mutes, and the
// note each string sounds under the box.
function drawChordBox(MIDI){
  const NS=MIDI.length;
  if(!fitDiag())return;
  const w=diagC.clientWidth,h=diagC.clientHeight;
  diagX.clearRect(0,0,w,h);
  const vs=voicingsFor(diagChord.root,diagChord.q);
  const v=vs[Math.min(voicingIdx,vs.length-1)];
  const frets=v.frets;
  // Window: below the 5th fret show from the nut, otherwise start at the
  // lowest fretted note so a high barre shape stays framed.
  const played=frets.filter(f=>f>=0);
  const fMax=played.length?Math.max(...played):3;
  const fMinPos=played.filter(f=>f>0);
  const fMin=fMinPos.length?Math.min(...fMinPos):0;
  const base=fMax<=4?0:Math.max(1,fMin);
  const nFrets=Math.max(5,fMax-base+(base>0?1:0));
  const pad={t:80,b:34,l:40,r:28};
  const gw=w-pad.l-pad.r, gh=h-pad.t-pad.b;
  const sx=i=>pad.l+gw*i/(NS-1);
  const fy=f=>pad.t+gh*f/nFrets;
  // Window row r (0-based) holds absolute fret base+r+(base>0?0:1).
  const rowOf=f=>base>0?f-base:f-1;
  diagTitle(w,(v.name&&v.name!=='—'?v.name+' · ':'')+(QUALS[diagChord.q]?QUALS[diagChord.q].full:''));
  fretInlays(sx(Math.floor((NS-1)/2)),sx(Math.ceil((NS-1)/2)),fy,base>0?base-1:0,nFrets);
  fretGrid(pad.l,pad.l+gw,fy,nFrets,base===0);
  for(let s=0;s<NS;s++)stringLine(sx(s),fy(0),fy(nFrets),NS===6?1.9-s*0.22:1.4);
  // Position label for a window up the neck.
  if(base>0){
    diagX.font='600 12px '+F_SANS;diagX.fillStyle=UI.ink2;
    diagX.textAlign='right';diagX.textBaseline='middle';
    diagX.fillText(base+'fr',pad.l-10,fy(0.5));
    diagX.textBaseline='alphabetic';
  }
  const fing=fingerFor(frets,v.barre||0);
  const dR=Math.min(11.5,gw/(NS*1.9));
  // Barre: one capsule from the lowest barred string to the highest.
  let barreRow=-1;
  if(v.barre){
    const barred=frets.map((f,s)=>f===v.barre?s:-1).filter(s=>s>=0);
    if(barred.length>1){
      barreRow=rowOf(v.barre);
      const y=fy(barreRow+0.5), x0=sx(Math.min(...barred)), x1=sx(Math.max(...barred));
      const isRoot=barred.some(s=>(MIDI[s]+v.barre)%12===diagChord.root);
      diagX.fillStyle='#e6e9ef';
      diagX.beginPath();
      if(diagX.roundRect)diagX.roundRect(x0-dR,y-dR,x1-x0+2*dR,2*dR,dR);else diagX.rect(x0-dR,y-dR,x1-x0+2*dR,2*dR);
      diagX.fill();
      if(isRoot){diagX.strokeStyle=pcColorA(diagChord.root,0.6,62);diagX.lineWidth=2;diagX.stroke();}
    }
  }
  for(let s=0;s<NS;s++){
    const f=frets[s], x=sx(s);
    if(f<0){muteMark(x,pad.t-16);continue;}
    const pc=(MIDI[s]+f)%12;
    if(f===0)openRing(x,pad.t-16,pc);
    else{
      const y=fy(rowOf(f)+0.5);
      if(rowOf(f)===barreRow&&f===v.barre){
        // On the barre: a dot only for the root string, so the root still
        // reads; the capsule carries finger 1 on its last string.
        if(pc===diagChord.root)noteDot(x,y,dR,pc,'1');
        else if(s===frets.lastIndexOf(v.barre)){diagX.fillStyle='#14171f';diagX.font='600 '+Math.max(9,Math.round(dR*0.92))+'px '+F_SANS;diagX.textAlign='center';diagX.textBaseline='middle';diagX.fillText('1',x,y+0.5);diagX.textBaseline='alphabetic';}
      }else noteDot(x,y,dR,pc,String(fing[s]||''));
    }
    stringLabel(x,h-12,NOTE_NAMES[pc],pc===diagChord.root?pcColor(pc,70):UI.dim);
  }
}

/* violin: first-position map of chord tones on G-D-A-E */
const VLN_MIDI=[55,62,69,76], VLN_NAMES=['G','D','A','E'];
// Fingerboard map for bowed strings: every chord tone reachable in first
// position, since violin has no frets and players find notes by chord tone.
function drawViolin(){
  if(!fitDiag())return;
  const w=diagC.clientWidth,h=diagC.clientHeight;
  diagX.clearRect(0,0,w,h);
  const tones=chordTones();
  const pad={t:80,b:40,l:44,r:44};
  const gw=w-pad.l-pad.r,gh=h-pad.t-pad.b;
  const sx=i=>pad.l+gw*i/3;
  const NPOS=7; // semitones in reach of 1st position
  const py=st=>pad.t+gh*st/NPOS;
  diagTitle(w,'First position · chord tones');
  // fingerboard
  diagX.fillStyle='rgba(255,255,255,0.035)';
  diagX.beginPath();
  if(diagX.roundRect)diagX.roundRect(pad.l-18,pad.t,gw+36,gh+8,[0,0,10,10]);else diagX.rect(pad.l-18,pad.t,gw+36,gh+8);
  diagX.fill();
  // semitone guides, then the nut
  for(let st=1;st<=NPOS;st++){
    diagX.strokeStyle='rgba(255,255,255,0.06)';diagX.lineWidth=1;
    diagX.beginPath();diagX.moveTo(pad.l-18,px(py(st)));diagX.lineTo(pad.l+gw+18,px(py(st)));diagX.stroke();
  }
  diagX.fillStyle='#dfe3ea';diagX.fillRect(pad.l-18,pad.t-4,gw+36,5);
  // finger zones on the right
  diagX.font='500 11px '+F_SANS;diagX.fillStyle=UI.faint;diagX.textAlign='left';diagX.textBaseline='middle';
  [['1',1.5],['2',3.5],['3',5],['4',6.5]].forEach(([f,st])=>diagX.fillText(f,pad.l+gw+26,py(st)));
  diagX.textBaseline='alphabetic';
  for(let s=0;s<4;s++){
    stringLine(sx(s),pad.t,pad.t+gh,2.2-s*0.4);
    stringLabel(sx(s),h-pad.b+26,VLN_NAMES[s]);
  }
  const dR=Math.min(12,gw/9);
  for(let s=0;s<4;s++)for(let st=0;st<=NPOS;st++){
    const pc=(VLN_MIDI[s]+st)%12;
    if(!tones.has(pc))continue;
    if(st===0)openRing(sx(s),pad.t-16,pc);
    else noteDot(sx(s),py(st),dR,pc,shortName(pc));
  }
}

/* piano: the chord in root position from middle C's octave */
// Two octaves, C4 to B5. The chord sits in root position on the root at or
// above C4. Under the keys: each tone with its interval name.
function drawPiano(){
  if(!fitDiag())return;
  const w=diagC.clientWidth,h=diagC.clientHeight;
  diagX.clearRect(0,0,w,h);
  const q=QUALS[diagChord.q]||QUALS[''];
  const notes=q.iv.map(iv=>60+diagChord.root+iv);
  const on=new Set(notes);
  diagTitle(w,'Root position · '+q.full);
  const NW=14, kx=14, kw=w-28, ww=kw/NW;
  const ky=74, kh=Math.min(h*0.48,ww*6.4), bh=kh*0.6, bw=ww*0.6;
  const WHITE=[0,2,4,5,7,9,11], BLACK={1:0,3:1,6:3,8:4,10:5};
  // white keys
  for(let i=0;i<NW;i++){
    const m=60+Math.floor(i/7)*12+WHITE[i%7], x=kx+i*ww, pc=m%12;
    const hit=on.has(m), isRoot=hit&&pc===diagChord.root;
    diagX.fillStyle=isRoot?pcColor(pc,66):hit?'#8fc4ff':'#d5d9e0';
    diagX.beginPath();
    if(diagX.roundRect)diagX.roundRect(x+0.75,ky,ww-1.5,kh,[0,0,4,4]);else diagX.rect(x+0.75,ky,ww-1.5,kh);
    diagX.fill();
    if(hit){
      diagX.fillStyle=isRoot?'#07080c':'#14171f';
      diagX.beginPath();diagX.arc(x+ww/2,ky+kh-12,Math.min(5,ww*0.22),0,7);diagX.fill();
    }
    if(m===60){diagX.font='500 10px '+F_SANS;diagX.fillStyle=UI.faint;diagX.textAlign='center';diagX.fillText('C4',x+ww/2,ky+kh+14);}
  }
  // black keys
  for(let o=0;o<2;o++)for(const k in BLACK){
    const m=60+o*12+(+k), x=kx+(o*7+BLACK[k]+1)*ww-bw/2, pc=m%12;
    const hit=on.has(m), isRoot=hit&&pc===diagChord.root;
    diagX.fillStyle=isRoot?pcColor(pc,58):hit?'#6aa8ec':'#0b0d12';
    diagX.beginPath();
    if(diagX.roundRect)diagX.roundRect(x,ky-1,bw,bh,[0,0,3,3]);else diagX.rect(x,ky-1,bw,bh);
    diagX.fill();
    if(!hit){diagX.strokeStyle='rgba(255,255,255,0.10)';diagX.lineWidth=1;diagX.stroke();}
    else{diagX.fillStyle=isRoot?'#07080c':'#14171f';diagX.beginPath();diagX.arc(x+bw/2,ky+bh-9,Math.min(4,bw*0.25),0,7);diagX.fill();}
  }
  // tone table: name over interval
  const ty=ky+kh+52, cw=Math.min(64,kw/notes.length);
  const x0=w/2-cw*notes.length/2+cw/2;
  notes.forEach((m,i)=>{
    const pc=m%12, x=x0+i*cw, isRoot=pc===diagChord.root;
    diagX.textAlign='center';
    diagX.font='500 20px '+F_SERIF;diagX.fillStyle=isRoot?pcColor(pc,72):UI.ink;
    diagX.fillText(NOTE_NAMES[pc],x,ty);
    diagX.font='500 11px '+F_SANS;diagX.fillStyle=UI.dim;
    diagX.fillText(DEG_NAMES[q.iv[i]%12],x,ty+18);
  });
}

/* ═══════════ INPUT METER — live scope + frequency bands ═══════════
   Left strip of Now Playing: top = oscilloscope of the raw mic
   waveform, below = 20 log-spaced band bars (low at bottom) with
   peak-hold ticks, inferno-colored by level like the spectrogram. */
const meterC=$('meterCanvas'),meterX=meterC.getContext('2d');
// 20 log-spaced bands from 60 Hz to 4200 Hz; MLOGR is the total log span.
const MBANDS=20,MF0=60,MF1=4200,MLOGR=Math.log(MF1/MF0);
// Slowly decaying peak-hold per band.
const meterPeaks=new Float32Array(MBANDS);
let scopeBuf=null,scopePhase=0;
function drawMeter(){
  const cw=meterC.clientWidth,ch=meterC.clientHeight;
  if(cw<24||ch<80)return;
  const dpr=Math.min(devicePixelRatio||1,2);
  if(meterC.width!==Math.round(cw*dpr)){meterC.width=Math.round(cw*dpr);meterC.height=Math.round(ch*dpr);}
  meterX.setTransform(dpr,0,0,dpr,0,0);
  meterX.clearRect(0,0,cw,ch);

  // ── oscilloscope (top) ──
  const scopeH=Math.min(86,ch*0.22);
  const mid=scopeH*0.5+6;
  meterX.strokeStyle='rgba(200,214,235,0.1)';meterX.lineWidth=1;
  meterX.beginPath();meterX.moveTo(4,mid);meterX.lineTo(cw-4,mid);meterX.stroke();
  if(micOn){
    // Read the raw waveform and trace it; glow grows with input level.
    if(!scopeBuf)scopeBuf=new Float32Array(2048);
    analyser.getFloatTimeDomainData(scopeBuf);
    const amp=Math.min(1,level*4+0.15);
    meterX.strokeStyle=`rgba(200,214,235,${0.35+amp*0.6})`;
    meterX.lineWidth=1.3;
    meterX.shadowColor='rgba(200,214,235,0.6)';meterX.shadowBlur=amp*8;
    meterX.beginPath();
    const N=scopeBuf.length;
    for(let x=0;x<cw-8;x++){
      const v=scopeBuf[(x/(cw-8)*(N-1))|0];
      const y=mid-Math.max(-1,Math.min(1,v*2.4))*(scopeH*0.44);
      x?meterX.lineTo(4+x,y):meterX.moveTo(4+x,y);
    }
    meterX.stroke();meterX.shadowBlur=0;
  }
  // divider
  meterX.strokeStyle='rgba(200,214,235,0.16)';
  meterX.beginPath();meterX.moveTo(0,scopeH+12);meterX.lineTo(cw,scopeH+12);meterX.stroke();
  meterX.font='500 9px '+F_SANS;
  meterX.fillStyle='rgba(138,146,160,0.6)';
  meterX.textAlign='left';meterX.textBaseline='bottom';
  meterX.fillText('mic',4,scopeH+10);

  // ── band meter (bottom, low → high going up) ──
  const bTop=scopeH+18,bBot=ch-8;
  const bandH=(bBot-bTop)/MBANDS;
  const barX=4,barW=cw-8;
  meterX.textBaseline='middle';
  // Each band: take the loudest bin in its frequency range, normalize to the
  // display dB window, then draw the bar and a decaying peak-hold tick.
  for(let b=0;b<MBANDS;b++){
    const f0=MF0*Math.exp(b/MBANDS*MLOGR);
    const f1=MF0*Math.exp((b+1)/MBANDS*MLOGR);
    let t=0;
    if(micOn){
      let m=-160;
      const i0=Math.max(1,Math.floor(f0/binHz)),i1=Math.min(freqData.length-1,Math.ceil(f1/binHz));
      for(let i=i0;i<=i1;i++)if(freqData[i]>m)m=freqData[i];
      t=(m-DB_LO)/(DB_HI-DB_LO);t=t<0?0:t>1?1:t;
    }
    meterPeaks[b]=Math.max(t,meterPeaks[b]-0.014);
    const y=bBot-(b+1)*bandH;
    // track
    meterX.fillStyle='rgba(200,214,235,0.05)';
    meterX.fillRect(barX,y+1.5,barW,bandH-3);
    // bar
    if(t>0.02){
      const li=(t*255)|0;
      meterX.fillStyle=`rgb(${ILUT[li*3]},${ILUT[li*3+1]},${ILUT[li*3+2]})`;
      meterX.fillRect(barX,y+1.5,barW*t,bandH-3);
    }
    // peak-hold tick
    if(meterPeaks[b]>0.03){
      const li=(meterPeaks[b]*255)|0;
      meterX.fillStyle=`rgba(${ILUT[li*3]},${ILUT[li*3+1]},${ILUT[li*3+2]},0.95)`;
      meterX.fillRect(barX+barW*meterPeaks[b]-1,y+1,2,bandH-2);
    }
  }
  // freq labels along the band stack
  meterX.fillStyle='rgba(138,146,160,0.6)';
  meterX.textAlign='left';
  [[100,'100'],[440,'440'],[1000,'1k'],[4000,'4k']].forEach(([f,l])=>{
    const b=Math.log(f/MF0)/MLOGR*MBANDS;
    const y=bBot-b*bandH;
    meterX.fillText(l,barX+1,y);
  });
}

/* ═══════════ STAFF ═══════════ */
const staffC=$('staffCanvas'),staffX=staffC.getContext('2d');
let staffDirty=true;
// Clear button: reset the log, tally, and dominant votes, then repaint empty.
$('clearStaff').addEventListener('click',()=>{
  chordLog.length=0;pendingLog=false;
  for(const k in tally)delete tally[k];
  for(const k in domScores)delete domScores[k];
  domKey=null;renderDominant();
  renderTally();
  $('st-log').textContent='0 logged';staffDirty=true;
});
// The chord log as text, four chords to a bar like the staff:
// "| C Em7 Em C | Am F G C |".
function logText(){
  const names=chordLog.map(e=>NOTE_NAMES[e.root]+e.q);
  const bars=[];
  for(let i=0;i<names.length;i+=4)bars.push(names.slice(i,i+4).join(' '));
  return bars.length?'| '+bars.join(' | ')+' |':'';
}
// Show a short result on a button, then restore its label.
function flashBtn(b,t){
  if(!b.dataset.label)b.dataset.label=b.innerHTML;
  b.innerHTML=t;clearTimeout(b._t);
  b._t=setTimeout(()=>{b.innerHTML=b.dataset.label;},1400);
}
// Copy the log. The Clipboard API comes first. A frame without the
// clipboard-write permission refuses it, so a hidden textarea and
// execCommand('copy') are the fallback.
async function copyLog(){
  const txt=logText(),b=$('copyStaff');
  if(!txt){flashBtn(b,'Nothing yet');return;}
  let ok=false;
  try{await navigator.clipboard.writeText(txt);ok=true;}catch(_){}
  if(!ok){
    const ta=document.createElement('textarea');
    ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    try{ok=document.execCommand('copy');}catch(_){}
    ta.remove();
  }
  flashBtn(b,ok?'✓ Copied':'Copy failed');
}
$('copyStaff').addEventListener('click',copyLog);
/* diatonic step index of pc for staff placement (C=0..B=6) + sharp flag */
// PC_STEP maps a pitch class to its letter step so sharps share a line with the
// natural below them; PC_SHARP flags which pitch classes draw a sharp glyph.
const PC_STEP=[0,0,1,1,2,3,3,4,4,5,5,6];
const PC_SHARP=[0,1,0,1,0,0,1,0,1,0,1,0];
// Staff geometry in CSS px. SP is one staff space; the other sizes follow
// engraving practice: notehead about 1.3 spaces wide, stem 3.5 spaces long.
const ST={H:156,SP:10,TOP:50,SLOT:60,LEAD:112};
// Staff position of a semitone above C4: 0 = bottom line (E4), 1 = space above.
function staffPos(semi){return PC_STEP[semi%12]+7*Math.floor(semi/12)-2;}
// A sharp drawn as lines (no music font needed), centred on (x, y).
function sharpGlyph(g,x,y,sp,col){
  g.strokeStyle=col;g.lineCap='butt';
  g.lineWidth=1;
  g.beginPath();
  g.moveTo(x-1.8,y-sp*1.25);g.lineTo(x-1.8,y+sp*1.35);
  g.moveTo(x+1.8,y-sp*1.35);g.lineTo(x+1.8,y+sp*1.25);
  g.stroke();
  g.lineWidth=sp*0.24;
  g.beginPath();
  g.moveTo(x-4,y-sp*0.3+1.4);g.lineTo(x+4,y-sp*0.3-1.4);
  g.moveTo(x-4,y+sp*0.4+1.4);g.lineTo(x+4,y+sp*0.4-1.4);
  g.stroke();
}
// Render the running staff: five lines, treble clef, 4/4, a bar line every
// four chords, and each logged chord as a root-position stack of quarter
// notes with its symbol above. The root head carries the root's hue.
function drawStaff(){
  staffDirty=false;
  const dpr=Math.min(devicePixelRatio||1,2);
  const {H,SP,TOP,SLOT,LEAD}=ST;
  const n=Math.ceil(Math.max(16,chordLog.length+2)/4)*4;
  const endX=LEAD+n*SLOT-SLOT/2;
  const W=Math.max($('staffScroll').clientWidth,endX+16);
  staffC.style.width=W+'px';
  staffC.width=Math.round(W*dpr);staffC.height=Math.round(H*dpr);
  const g=staffX;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,W,H);
  const lineY=i=>TOP+i*SP;               // i = 0 top line (F5) .. 4 bottom (E4)
  const yOf=pos=>lineY(4)-pos*SP/2;
  const INK='rgba(236,239,244,0.86)', LINE='rgba(236,239,244,0.34)';
  // staff lines
  g.strokeStyle=LINE;g.lineWidth=1;
  for(let i=0;i<5;i++){g.beginPath();g.moveTo(12,px(lineY(i)));g.lineTo(endX,px(lineY(i)));g.stroke();}
  // treble clef: a system music font (Apple Symbols on macOS and iOS)
  g.font='300 '+Math.round(SP*7.4)+'px "Apple Symbols","Noto Music","Segoe UI Symbol","Bravura Text",serif';
  g.fillStyle=INK;g.textAlign='left';g.textBaseline='middle';
  g.fillText('𝄞',16,lineY(2)+3);
  // 4/4: two numerals, each two spaces tall
  g.font='600 '+Math.round(SP*2.5)+'px '+F_SERIF;
  g.textAlign='center';
  g.fillText('4',74,lineY(1));g.fillText('4',74,lineY(3));
  g.textBaseline='alphabetic';
  // bar lines at the slot edges; a final double bar at the end
  for(let b=1;b<=n/4;b++){
    const x=LEAD+b*4*SLOT-SLOT/2;
    g.fillStyle=INK;
    if(b===n/4){g.fillRect(x-4,lineY(0),3.5,4*SP);g.fillRect(x-8,lineY(0),1,4*SP);}
    else g.fillRect(Math.round(x),lineY(0),1,4*SP);
  }
  const RX=SP*0.66, RY=SP*0.47, STEM=SP*3.5;
  chordLog.forEach((e,i)=>{
    const x=LEAD+i*SLOT;
    const q=QUALS[e.q]||QUALS[''];
    const semis=q.iv.map(iv=>e.root+iv);
    const heads=semis.map(s=>({s,pos:staffPos(s),sharp:PC_SHARP[s%12],root:s===e.root,dx:0})).sort((a,b)=>a.pos-b.pos);
    const lo=heads[0].pos, hi=heads[heads.length-1].pos;
    const up=(lo+hi)/2<4;
    // seconds: the second head goes to the other side of the stem
    if(up){for(let k=1;k<heads.length;k++)if(heads[k].pos-heads[k-1].pos===1&&!heads[k-1].dx)heads[k].dx=RX*2-1;}
    else{for(let k=heads.length-2;k>=0;k--)if(heads[k+1].pos-heads[k].pos===1&&!heads[k+1].dx)heads[k].dx=-(RX*2-1);}
    const newest=i===chordLog.length-1;
    if(newest){
      g.fillStyle='rgba(143,196,255,0.07)';
      g.beginPath();
      if(g.roundRect)g.roundRect(x-SLOT/2+3,6,SLOT-6,H-12,8);else g.rect(x-SLOT/2+3,6,SLOT-6,H-12);
      g.fill();
    }
    // ledger lines below (C4 and down) and above (A5 and up)
    g.fillStyle=LINE;
    const minDx=Math.min(0,...heads.map(h=>h.dx)), maxDx=Math.max(0,...heads.map(h=>h.dx));
    for(let p=-2;p>=lo;p-=2)g.fillRect(x-RX*1.6+minDx,Math.round(yOf(p)),RX*3.2+maxDx-minDx,1);
    for(let p=10;p<=hi;p+=2)g.fillRect(x-RX*1.6+minDx,Math.round(yOf(p)),RX*3.2+maxDx-minDx,1);
    // accidentals, top down, in columns so close ones do not touch
    const placed=[];
    heads.filter(h=>h.sharp).reverse().forEach(h=>{
      let col=0;while(placed.some(p=>p.col===col&&Math.abs(p.pos-h.pos)<6))col++;
      placed.push({col,pos:h.pos});
      sharpGlyph(g,x+minDx-RX-6-col*9,yOf(h.pos),SP,INK);
    });
    // noteheads
    for(const h of heads){
      g.save();g.translate(x+h.dx,yOf(h.pos));g.rotate(-0.36);
      g.fillStyle=h.root?pcColor(e.root,66):INK;
      g.beginPath();g.ellipse(0,0,RX,RY,0,0,7);g.fill();
      g.restore();
    }
    // one stem for the stack
    const sx=up?x+RX-0.6:x-RX+0.6;
    g.strokeStyle=INK;g.lineWidth=1.2;
    g.beginPath();
    if(up){g.moveTo(sx,yOf(lo)-1);g.lineTo(sx,yOf(hi)-STEM);}
    else{g.moveTo(sx,yOf(hi)+1);g.lineTo(sx,yOf(lo)+STEM);}
    g.stroke();
    // chord symbol
    g.font='600 13px '+F_SANS;g.textAlign='center';
    g.fillStyle=pcColor(e.root,newest?76:70);
    g.fillText(NOTE_NAMES[e.root]+e.q,x,18);
  });
  if(!chordLog.length){
    g.font='italic 400 15px '+F_SERIF;
    g.fillStyle='rgba(138,146,160,0.85)';
    g.textAlign='left';
    g.fillText('Chords you play land here, in order, four to a bar.',LEAD-SLOT/2+8,20);
  }
  // Keep the newest chord in view as the log grows.
  const sc=$('staffScroll');sc.scrollLeft=sc.scrollWidth;
}

/* ════════════════════════════════════════════════════════════
   TUNER — autocorrelation pitch + rainbow waterfall spectrogram
   Hue = pitch class of the frequency row, so an in-tune string
   paints a solid stripe of one color along its reference line.
   GREP: autoCorrelate | updateTuner | drawSpec
   ════════════════════════════════════════════════════════════ */
const specC=$('specCanvas'),specX=specC.getContext('2d');
// Spectrogram frequency window (70..1300 Hz, log-scaled) and its total log span.
const SFMIN=70,SFMAX=1300,SLOGR=Math.log(SFMAX/SFMIN);
const DB_LO=-90,DB_HI=-25;               // display dynamic range
const AXIS_L=36,AXIS_R=30,AXIS_T=6,AXIS_B=18;  // CSS-px gutters
// Standard guitar tuning: name, octave, frequency, and pitch class per string.
// Drives the reference lines, the tuning ladder, and the string buttons.
const GTR_STRINGS=[
  {n:'E',o:2,f:82.41,pc:4},{n:'A',o:2,f:110.00,pc:9},{n:'D',o:3,f:146.83,pc:2},
  {n:'G',o:3,f:196.00,pc:7},{n:'B',o:3,f:246.94,pc:11},{n:'E',o:4,f:329.63,pc:4}
];
// Latest detected pitch (Hz), its pitch class, and cents error for the tuner.
let lastPitch=0,lastPitchPc=0,lastCents=999;
let tuneTarget=-1;   // index into GTR_STRINGS, -1 = auto (follow detected pitch)
// The string the tuner measures against: a locked one, or the nearest string to
// the detected pitch when in auto mode (null if nothing is close enough).
function currentTuneTarget(){
  if(tuneTarget>=0)return GTR_STRINGS[tuneTarget];
  if(lastPitch>0){
    let bi=-1,bd=1e9;
    GTR_STRINGS.forEach((st,i)=>{
      const d=Math.abs(Math.log2(lastPitch/st.f));
      if(d<bd){bd=d;bi=i;}
    });
    if(bd<0.45)return GTR_STRINGS[bi];   // within ~half octave of a string
  }
  return null;
}

/* inferno colormap LUT — perceptually uniform, amplitude → color */
// Precompute a 256-entry RGB lookup table by linearly interpolating the inferno
// control points, so the spectrogram maps normalized dB to color with one index.
const INFERNO=[[0,0,0.016],[0.087,0.044,0.224],[0.258,0.039,0.406],[0.416,0.090,0.433],
  [0.578,0.148,0.404],[0.735,0.215,0.330],[0.865,0.316,0.226],[0.955,0.455,0.120],
  [0.987,0.622,0.145],[0.964,0.790,0.318],[0.988,0.998,0.645]];
const ILUT=new Uint8ClampedArray(256*3);
for(let i=0;i<256;i++){
  const t=i/255*(INFERNO.length-1),k=Math.min(INFERNO.length-2,Math.floor(t)),fr=t-k;
  for(let c=0;c<3;c++)ILUT[i*3+c]=255*(INFERNO[k][c]+fr*(INFERNO[k+1][c]-INFERNO[k][c]));
}

// Note grid: one faint line per natural note in the window, labelled at
// every C and A. MIDI numbers; the Hz values follow the A4 reference.
const NOTE_GRID=[];
for(let m=37;m<=88;m++){const pc=m%12;if(!PC_SHARP[pc])NOTE_GRID.push({m,lbl:pc===0||pc===9?NOTE_NAMES[pc]+(Math.floor(m/12)-1):''});}

// Offscreen waterfall buffer, its per-column image scratch, and the timestamp of
// each column so the time ruler can label real elapsed seconds.
let specBuf=null,specBufX=null,colImg=null,specPW=0,specPH=0,specDpr=1;
let colTimes=[];
function colAt(tms){ // first column with timestamp ≥ tms
  // Binary search the column times for the ruler tick placement.
  let lo=0,hi=colTimes.length-1;
  while(lo<hi){const m=(lo+hi)>>1;if(colTimes[m]<tms)lo=m+1;else hi=m;}
  return lo;
}

// Draw the scrolling spectrogram: shift the buffer left one pixel, paint a fresh
// FFT column on the right, then overlay axes, string lines, and the tuning ladder.
function drawSpec(){
  const cssW=specC.clientWidth,cssH=specC.clientHeight;
  if(cssW<80||cssH<80)return;
  const dpr=Math.min(devicePixelRatio||1,2);
  // Plot area in device pixels, inside the axis gutters.
  const pw=Math.round((cssW-AXIS_L-AXIS_R)*dpr);
  const ph=Math.round((cssH-AXIS_T-AXIS_B)*dpr);
  // On first run or resize, allocate the offscreen buffer and rescale old content.
  if(specC.width!==Math.round(cssW*dpr)||specC.height!==Math.round(cssH*dpr)||pw!==specPW||ph!==specPH){
    specC.width=Math.round(cssW*dpr);specC.height=Math.round(cssH*dpr);
    const nb=document.createElement('canvas');nb.width=pw;nb.height=ph;
    const nx=nb.getContext('2d');nx.imageSmoothingEnabled=false;
    nx.fillStyle='#000004';nx.fillRect(0,0,pw,ph);
    if(specBuf)nx.drawImage(specBuf,0,0,pw,ph);
    specBuf=nb;specBufX=nx;specPW=pw;specPH=ph;specDpr=dpr;
    colImg=specBufX.createImageData(1,ph);
    const now=performance.now();
    colTimes=new Array(pw).fill(now);
  }

  /* ── new column: exact per-device-pixel sampling of the FFT ──
     Rows covering >1 bin take the max (peaks never vanish);
     rows finer than a bin interpolate linearly (no staircase). */
  // Scroll one pixel left, then build the new rightmost column top-down.
  specBufX.drawImage(specBuf,-1,0);
  const D=colImg.data,NB=freqData.length;
  for(let y=0;y<ph;y++){
    // Log-map this row back to a frequency range, then to FFT bin indices.
    const f1=SFMIN*Math.exp((1-y/ph)*SLOGR);
    const f0=SFMIN*Math.exp((1-(y+1)/ph)*SLOGR);
    const b0=f0/binHz,b1=f1/binHz;
    let db;
    if(b1-b0>1){
      let m=-160;
      const i0=Math.max(1,Math.floor(b0)),i1=Math.min(NB-1,Math.ceil(b1));
      for(let i=i0;i<=i1;i++)if(freqData[i]>m)m=freqData[i];
      db=m;
    }else{
      const bc=(b0+b1)/2,i=Math.max(1,Math.min(NB-2,Math.floor(bc))),fr=bc-i;
      db=freqData[i]+(freqData[i+1]-freqData[i])*fr;
    }
    // Normalize dB to 0..1 and look up the inferno color for this pixel.
    let t=(db-DB_LO)/(DB_HI-DB_LO);t=t<0?0:t>1?1:t;
    const li=(t*255)|0;
    D[y*4]=ILUT[li*3];D[y*4+1]=ILUT[li*3+1];D[y*4+2]=ILUT[li*3+2];D[y*4+3]=255;
  }
  // Blit the fresh column and advance the per-column timestamp ring.
  specBufX.putImageData(colImg,pw-1,0);
  colTimes.push(performance.now());colTimes.shift();

  /* ── composite the instrument frame ── */
  specX.setTransform(1,0,0,1,0,0);
  specX.imageSmoothingEnabled=false;
  specX.clearRect(0,0,specC.width,specC.height);
  specX.drawImage(specBuf,Math.round(AXIS_L*dpr),Math.round(AXIS_T*dpr));
  specX.setTransform(dpr,0,0,dpr,0,0);
  const px0=AXIS_L,py0=AXIS_T,pwc=pw/dpr,phc=ph/dpr;
  // Map any frequency to its y in the plot (log axis, low at the bottom).
  const yOf=f=>py0+phc*(1-Math.log(f/SFMIN)/SLOGR);

  // note grid + tick marks + labels (C and A)
  specX.font='500 10px '+F_SANS;
  specX.textBaseline='middle';
  for(const tk of NOTE_GRID){
    const f=A4*Math.pow(2,(tk.m-69)/12);
    if(f<SFMIN||f>SFMAX)continue;
    const y=Math.round(yOf(f))+0.5;
    specX.strokeStyle=tk.lbl?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.045)';
    specX.lineWidth=1;
    specX.beginPath();specX.moveTo(px0,y);specX.lineTo(px0+pwc,y);specX.stroke();
    if(tk.lbl){
      specX.strokeStyle='rgba(255,255,255,0.4)';
      specX.beginPath();specX.moveTo(px0-3,y);specX.lineTo(px0,y);specX.stroke();
      specX.fillStyle=tk.lbl[0]==='C'?'rgba(236,239,244,0.85)':'rgba(138,146,160,0.9)';
      specX.textAlign='right';specX.fillText(tk.lbl,px0-5,y);
    }
  }

  // time ruler along the bottom (real elapsed time per column)
  const now=performance.now();
  const windowS=(now-colTimes[0])/1000;
  const step=windowS>22?5:windowS>9?2:1;
  specX.textAlign='center';specX.textBaseline='top';
  for(let s=step;s<=Math.floor(windowS);s+=step){
    const idx=colAt(now-s*1000);
    if(idx<=0||idx>=colTimes.length-1)continue;
    const x=px0+idx/dpr;
    if(x>px0+pwc-38)continue;   // keep clear of the "now" label
    specX.strokeStyle='rgba(200,214,235,0.28)';specX.lineWidth=1;
    specX.beginPath();specX.moveTo(x,py0+phc);specX.lineTo(x,py0+phc+3);specX.stroke();
    specX.fillStyle='rgba(138,146,160,0.75)';
    specX.fillText('-'+s+'s',x,py0+phc+5);
  }
  specX.fillStyle='rgba(200,208,224,0.7)';specX.textAlign='right';
  specX.fillText('now ▸',px0+pwc,py0+phc+5);

  // guitar string reference lines — dashed, labeled at the right edge
  // Dashed line at each open-string frequency; the active target is dimmed here
  // because the tuning ladder below draws it in full.
  const tgt=currentTuneTarget();
  specX.setLineDash([3,3]);
  specX.textBaseline='bottom';
  for(const s of GTR_STRINGS){
    const y=yOf(s.f);
    const isTgt=tgt===s;
    specX.strokeStyle=isTgt?'rgba(232,236,244,0.05)':'rgba(232,236,244,0.22)';
    specX.lineWidth=1;
    specX.beginPath();specX.moveTo(px0,y);specX.lineTo(px0+pwc,y);specX.stroke();
    specX.font='600 10px '+F_SANS;
    specX.fillStyle=isTgt?pcColor(s.pc,70):'rgba(210,220,236,0.75)';
    specX.textAlign='right';
    specX.fillText(s.n+s.o,px0+pwc-3,y-1);
  }
  specX.setLineDash([]);

  // ── tuning ladder: the full expected harmonic comb of the target ──
  // A string paints fundamental + overtones; in tune, every rung of the
  // played comb sits on these lines across the whole spectrum.
  if(tgt){
    specX.textBaseline='bottom';
    let lastLblY=1e9;
    for(let hn=1;hn*tgt.f<=SFMAX;hn++){
      const y=yOf(hn*tgt.f);
      specX.strokeStyle=pcColorA(tgt.pc,hn===1?0.75:0.45,62);
      specX.lineWidth=hn===1?1.6:1;
      specX.setLineDash(hn===1?[]:[5,4]);
      specX.beginPath();specX.moveTo(px0,y);specX.lineTo(px0+pwc,y);specX.stroke();
      if(lastLblY-y>11){   // rungs compress upward on the log axis — skip crowded labels
        specX.font='600 9px '+F_SANS;
        specX.fillStyle=pcColorA(tgt.pc,0.85,68);
        specX.textAlign='left';
        specX.fillText(hn===1?tgt.n+tgt.o+' ×1':'×'+hn,px0+3,y-1);
        lastLblY=y;
      }
    }
    specX.setLineDash([]);
    // measured comb: where the played harmonics actually are right now
    // Draw arrowheads at the played fundamental and its overtones; when they sit
    // on the target's rungs the string is in tune. Green means within 5 cents.
    if(lastPitch>0&&Math.abs(Math.log2(lastPitch/tgt.f))<0.45){
      const inTune=Math.abs(lastCents)<=5;
      const mCol=inTune?UI.ok:pcColor(lastPitchPc,64);
      for(let hn=1;hn*lastPitch<=SFMAX;hn++){
        const y=yOf(hn*lastPitch);
        specX.fillStyle=mCol;
        specX.beginPath();
        specX.moveTo(px0+pwc,y);specX.lineTo(px0+pwc-9,y-4);specX.lineTo(px0+pwc-9,y+4);
        specX.closePath();specX.fill();
      }
      // status chip: sharp/flat direction against the ladder
      specX.font='600 11px '+F_SANS;
      specX.textAlign='left';specX.textBaseline='top';
      specX.fillStyle=inTune?UI.ok:mCol;
      specX.fillText(inTune?'● in tune':(lastCents>0?'▲ sharp '+Math.abs(lastCents)+'¢':'▼ flat '+Math.abs(lastCents)+'¢'),px0+4,py0+4);
    }
  }

  // dB colorbar in the right gutter
  // Vertical legend from DB_HI (top) to DB_LO (bottom) using the same LUT.
  const cbX=px0+pwc+5,cbW=5;
  for(let y=0;y<phc;y++){
    const li=(255*(1-y/phc))|0;
    specX.fillStyle=`rgb(${ILUT[li*3]},${ILUT[li*3+1]},${ILUT[li*3+2]})`;
    specX.fillRect(cbX,py0+y,cbW,1.2);
  }
  specX.strokeStyle='rgba(200,214,235,0.3)';specX.lineWidth=1;
  specX.strokeRect(cbX+0.5,py0+0.5,cbW-1,phc-1);
  specX.font='500 9px '+F_SANS;
  specX.fillStyle='rgba(138,146,160,0.8)';specX.textAlign='left';
  specX.textBaseline='top';specX.fillText('-25',cbX+cbW+2,py0);
  specX.textBaseline='bottom';specX.fillText('-90',cbX+cbW+2,py0+phc);
  specX.save();
  specX.translate(cbX+cbW+9,py0+phc/2);specX.rotate(-Math.PI/2);
  specX.textAlign='center';specX.textBaseline='middle';
  specX.fillText('dB',0,0);
  specX.restore();

  // detected fundamental crosshair (comb markers cover the rest when targeting)
  // In auto mode, mark the detected pitch with a faint line and an arrowhead.
  if(lastPitch>=SFMIN&&lastPitch<=SFMAX){
    const y=yOf(lastPitch);
    specX.strokeStyle=pcColorA(lastPitchPc,0.35);specX.lineWidth=1;
    specX.beginPath();specX.moveTo(px0,y);specX.lineTo(px0+pwc,y);specX.stroke();
    if(!tgt){
      specX.fillStyle=pcColor(lastPitchPc,64);
      specX.beginPath();
      specX.moveTo(px0+pwc,y);specX.lineTo(px0+pwc-9,y-4.5);specX.lineTo(px0+pwc-9,y+4.5);
      specX.closePath();specX.fill();
    }
  }

  // plot frame
  specX.strokeStyle='rgba(255,255,255,0.12)';specX.lineWidth=1;
  specX.strokeRect(px0+0.5,py0+0.5,pwc-1,phc-1);
}

/* classic time-domain autocorrelation (ACF2+) */
// Estimate one fundamental frequency from a waveform window. The waveform aligns
// with copies of itself shifted by its period, so the first strong peak of the
// autocorrelation after the initial dip gives the period; sr/period is the pitch.
let tdBuf=null;
function autoCorrelate(buf,sr){
  const SIZE=buf.length;
  // Reject near-silence by RMS so noise never produces a spurious pitch.
  let rms=0;for(let i=0;i<SIZE;i++)rms+=buf[i]*buf[i];
  rms=Math.sqrt(rms/SIZE);
  if(rms<0.006)return -1;
  // Trim quiet head and tail to the first samples above a threshold (ACF2+ trick).
  let r1=0,r2=SIZE-1;const thres=0.2;
  for(let i=0;i<SIZE/2;i++)if(Math.abs(buf[i])<thres){r1=i;break;}
  for(let i=1;i<SIZE/2;i++)if(Math.abs(buf[SIZE-i])<thres){r2=SIZE-i;break;}
  const b2=buf.slice(r1,r2);const N=b2.length;
  if(N<64)return -1;
  // Autocorrelation: c[lag] is the overlap of the signal with itself at lag.
  const c=new Float32Array(N);
  for(let lag=0;lag<N;lag++){let s=0;for(let i=0;i<N-lag;i++)s+=b2[i]*b2[i+lag];c[lag]=s;}
  // Skip past the descending zero-lag lobe, then take the tallest later peak.
  let d=0;while(d<N-1&&c[d]>c[d+1])d++;
  let maxval=-1,maxpos=-1;
  for(let i=d;i<N;i++)if(c[i]>maxval){maxval=c[i];maxpos=i;}
  let T0=maxpos;if(T0<=0)return -1;
  // Parabolic interpolation around the peak refines the period to sub-sample.
  const x1=c[T0-1],x2=c[T0],x3=T0+1<N?c[T0+1]:x2;
  const a=(x1+x3-2*x2)/2,b=(x3-x1)/2;
  if(a)T0=T0-b/(2*a);
  return sr/T0;
}

// Run the pitch detector on the newest waveform and update the tuner readout:
// note name, frequency, cents error, and the needle position.
function updateTuner(){
  if(!tdBuf)tdBuf=new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(tdBuf);
  // Use a 2048-sample window: enough cycles for low strings, still cheap.
  const p=autoCorrelate(tdBuf.subarray(0,2048),AC.sampleRate);
  const nEl=$('tunerNote'),fEl=$('tunerFreq');
  // Outside the instrument's plausible range: blank the tuner and let the
  // needle spring back to centre.
  if(p<50||p>1400){
    lastPitch=0;lastCents=999;gLive=false;
    nEl.textContent='—';nEl.style.color='';nEl.style.textShadow='none';
    nEl.classList.remove('ok');
    fEl.textContent='Play one string';
    return;
  }
  // Convert Hz to MIDI, find the nearest note, and the cents error from it.
  const midi=69+12*Math.log2(p/A4), nearest=Math.round(midi);
  const cents=Math.round((midi-nearest)*100);
  const pc=((nearest%12)+12)%12, oct=Math.floor(nearest/12)-1;
  lastPitch=p;lastPitchPc=pc;
  // cents against the tuning target if one is active, else against nearest note
  const tgt=currentTuneTarget();
  if(tgt){
    let r=1200*Math.log2(p/tgt.f);
    r=((r%1200)+1200)%1200; if(r>600)r-=1200;   // fold octaves: harmonics count too
    lastCents=Math.round(r);
  }else lastCents=cents;
  const inTune=Math.abs(cents)<=5;
  nEl.textContent=NOTE_NAMES[pc]+oct;
  nEl.style.color=inTune?UI.ok:pcColor(pc,70);
  nEl.style.textShadow=inTune?'0 0 28px rgba(95,211,138,0.55)':'none';
  nEl.classList.toggle('ok',inTune);
  fEl.textContent=p.toFixed(1)+' Hz · '+(cents>0?'+':cents<0?'−':'±')+Math.abs(cents)+' ¢';
  gLive=true;gTarget=cents;gPc=pc;
}

/* reference-tone buttons: tap a string to hear it */
// Play a 2.2 s reference pitch: one triangle oscillator through a gain envelope
// with a fast attack and exponential release.
function playRef(freq){
  if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
  if(AC.state==='suspended')AC.resume();
  const t=AC.currentTime+0.02;
  const o=AC.createOscillator(),g=AC.createGain();
  o.type='triangle';o.frequency.value=freq;
  o.connect(g);g.connect(AC.destination);
  g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(0.28,t+0.015);
  g.gain.exponentialRampToValueAtTime(0.001,t+2.2);
  o.start(t);o.stop(t+2.3);
}
const strBtns=[];
// Reflect the locked/auto target in the string buttons and the label.
function syncStrBtns(){
  strBtns.forEach((b,i)=>b.classList.toggle('pinned',i===tuneTarget));
  const lbl=$('tuneTargetLbl');
  if(tuneTarget>=0){
    const t=GTR_STRINGS[tuneTarget];
    lbl.innerHTML='target <b style="color:'+pcColor(t.pc,68)+'">'+t.n+t.o+'</b> · locked — tap again to unlock';
  }else{
    lbl.textContent='target auto · tap a string to lock';
  }
}
// Build one button per string: tapping plays its reference tone and toggles the
// tuning lock onto that string.
GTR_STRINGS.forEach((s,i)=>{
  const b=document.createElement('button');
  b.className='strBtn';
  b.style.color=pcColor(s.pc,66);b.style.borderColor=pcColorA(s.pc,0.4);
  b.innerHTML=s.n+'<small>'+s.f.toFixed(0)+' Hz</small>';
  b.addEventListener('click',()=>{
    playRef(s.f);
    tuneTarget=tuneTarget===i?-1:i;   // toggle lock
    syncStrBtns();
  });
  $('stringRow').appendChild(b);strBtns.push(b);
});
syncStrBtns();

/* reference pitch A4 */
// A4 sets the tuner's note grid, the string targets and tones, and the strum
// synth. Orchestras often tune to 442, baroque groups to 415. Chord detection
// does not use it: estimateTuning follows the instrument by itself. The
// value is kept per browser (localStorage).
let A4=440;
try{const v=+localStorage.getItem('chordlab.a4');if(v>=415&&v<=466)A4=v;}catch(_){}
GTR_STRINGS.forEach(s=>{s.f440=s.f;});
function setA4(v){
  A4=Math.max(415,Math.min(466,Math.round(v)));
  GTR_STRINGS.forEach(s=>{s.f=s.f440*A4/440;});
  try{localStorage.setItem('chordlab.a4',String(A4));}catch(_){}
  $('a4Val').textContent='A4 '+A4+' Hz';
  $('a4Val').classList.toggle('off',A4!==440);
  strBtns.forEach((b,i)=>{b.querySelector('small').textContent=GTR_STRINGS[i].f.toFixed(0)+' Hz';});
}
$('a4Dn').addEventListener('click',()=>setA4(A4-1));
$('a4Up').addEventListener('click',()=>setA4(A4+1));
setA4(A4);

/* ═══════════ STRUM SYNTH ═══════════ */
// Audibly preview the shown chord. Collect the MIDI pitches for the current
// instrument and voicing, then play them staggered so it sounds like a strum.
function strum(){
  if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();
  if(AC.state==='suspended')AC.resume();
  // stag is the delay between strings; dur is each note's length.
  let midis=[],stag=0.055,dur=2.4;
  if(instrument==='guitar'||instrument==='ukulele'){
    // Fretted strings of the selected voicing become pitches (open MIDI + fret).
    const MIDI=instrument==='guitar'?GTR_MIDI:UKE_MIDI;
    const vs=voicingsFor(diagChord.root,diagChord.q);
    const v=vs[Math.min(voicingIdx,vs.length-1)];
    v.frets.forEach((f,st)=>{if(f>=0)midis.push(MIDI[st]+f);});
  }else if(instrument==='bass'){
    const base=28+((diagChord.root-4)%12+12)%12;   // lowest position on the E string
    midis=[base,base+7,base+12];                    // root · fifth · octave walk
    stag=0.22;dur=2.9;
  }else if(instrument==='piano'){
    // Piano: the root-position chord the diagram shows, rolled quickly.
    const q=QUALS[diagChord.q]||QUALS[''];
    midis=[48+diagChord.root].concat(q.iv.map(iv=>60+diagChord.root+iv));
    stag=0.03;dur=2.8;
  }else{
    // Violin (and fallback): block chord tones around middle C plus a low root.
    const q=QUALS[diagChord.q]||QUALS[''];
    midis=q.iv.map(iv=>60+((diagChord.root+iv)%12)+(diagChord.root+iv>=12?12:0));
    midis.unshift(48+diagChord.root);
  }
  // One master gain feeds the output; each note gets its own voice and envelope.
  const t0=AC.currentTime+0.03;
  const master=AC.createGain();master.gain.value=0.5;master.connect(AC.destination);
  midis.forEach((mn,i)=>{
    const f=A4*Math.pow(2,(mn-69)/12);
    const t=t0+i*stag;
    // Triangle fundamental plus a faint detuned octave sine for a warmer timbre.
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
$('strumBtn').addEventListener('click',strum);



/* ═══════════ TUNER GAUGE — arc needle on a spring ═══════════
   A 140 degree arc from -50 to +50 cents. updateTuner() sets the target
   (gTarget, gLive); drawGauge(dt) moves the needle toward it as a damped
   spring each frame, so it swings and settles like a real meter. Inside
   ±5 cents the in-tune band and the needle glow green. */
const gaugeC=$('gaugeCanvas'),gaugeX=gaugeC?gaugeC.getContext('2d'):null;
let gNeedle=0,gVel=0,gTarget=0,gLive=false,gPc=0,gGlow=0;
const G_SPAN=70*Math.PI/180;              // half of the arc, in radians
function drawGauge(dt){
  if(!gaugeX)return;
  // Spring: stiffness K, damping a little under critical, in small sub-steps.
  const K=160,C=2*Math.sqrt(K)*0.6,tgt=gLive?Math.max(-50,Math.min(50,gTarget)):0;
  const n=Math.max(1,Math.ceil(dt/0.008)),hs=dt/n;
  for(let i=0;i<n;i++){gVel+=(K*(tgt-gNeedle)-C*gVel)*hs;gNeedle+=gVel*hs;}
  if(!isFinite(gNeedle)){gNeedle=0;gVel=0;}
  const inTune=gLive&&Math.abs(gTarget)<=5;
  gGlow+=((inTune?1:0)-gGlow)*Math.min(1,dt*7);
  const w=gaugeC.clientWidth,h=gaugeC.clientHeight;
  if(w<40||h<30)return;
  const dpr=Math.min(devicePixelRatio||1,3);
  if(gaugeC.width!==Math.round(w*dpr)||gaugeC.height!==Math.round(h*dpr)){gaugeC.width=Math.round(w*dpr);gaugeC.height=Math.round(h*dpr);}
  const g=gaugeX;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,w,h);
  // Pivot under the arc; radius fits both the width and the height.
  const R=Math.min(w*0.46/Math.sin(G_SPAN),h*0.86);
  const cx=w/2,cy=h*0.06+R;
  const ang=c=>-Math.PI/2+c/50*G_SPAN;
  // track
  g.lineCap='round';
  g.strokeStyle='rgba(255,255,255,0.07)';g.lineWidth=10;
  g.beginPath();g.arc(cx,cy,R,ang(-50),ang(50));g.stroke();
  // in-tune band
  g.strokeStyle=`rgba(95,211,138,${0.28+gGlow*0.6})`;g.lineWidth=10;
  if(gGlow>0.05){g.shadowColor='rgba(95,211,138,0.8)';g.shadowBlur=18*gGlow;}
  g.beginPath();g.arc(cx,cy,R,ang(-5),ang(5));g.stroke();
  g.shadowBlur=0;g.lineCap='butt';
  // ticks every 5 cents, long every 10, labels at 0 and the ends
  for(let c=-50;c<=50;c+=5){
    const a=ang(c),major=c%10===0;
    const r0=R-(major?17:13),r1=R-8;
    g.strokeStyle=c===0?'rgba(236,239,244,0.75)':major?'rgba(236,239,244,0.38)':'rgba(236,239,244,0.18)';
    g.lineWidth=c===0?1.6:1;
    g.beginPath();g.moveTo(cx+Math.cos(a)*r0,cy+Math.sin(a)*r0);g.lineTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);g.stroke();
  }
  g.font='500 11px '+F_SANS;g.fillStyle=UI.dim;g.textBaseline='middle';
  [[-50,'♭ −50'],[50,'+50 ♯']].forEach(([c,t])=>{
    const a=ang(c),r=R-30;
    g.textAlign=c<0?'left':'right';
    g.fillText(t,cx+Math.cos(a)*r+(c<0?-4:4),cy+Math.sin(a)*r);
  });
  // needle: from inside the arc up to the track, coloured by state
  const a=ang(gNeedle);
  const col=!gLive?'rgba(138,146,160,0.55)':inTune?UI.ok:pcColor(gPc,64);
  g.strokeStyle=col;g.lineWidth=3;g.lineCap='round';
  if(gLive){g.shadowColor=inTune?'rgba(95,211,138,0.9)':pcColorA(gPc,0.7);g.shadowBlur=inTune?16:8;}
  g.beginPath();g.moveTo(cx+Math.cos(a)*(R*0.55),cy+Math.sin(a)*(R*0.55));g.lineTo(cx+Math.cos(a)*(R+6),cy+Math.sin(a)*(R+6));g.stroke();
  g.shadowBlur=0;g.lineCap='butt';
  g.fillStyle=col;
  g.beginPath();g.arc(cx+Math.cos(a)*(R+6),cy+Math.sin(a)*(R+6),3.2,0,7);g.fill();
  g.textBaseline='alphabetic';
}
