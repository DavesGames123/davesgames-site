// ============================================================================
//  HARMONY WHEEL  ·  a map of chord resolution as a mandala
// ----------------------------------------------------------------------------
//  Chords are nodes on a wheel; the arrows between them are the ways one chord
//  pulls toward another. The user taps chords to hear a voice-led pad and watch
//  every resolution light up, builds progressions in a pattern grid, or lets a
//  rule-obeying random walk (Wander) play itself.
//
//  The whole graph is generated from the circle of fifths, not stored by hand.
//  Twelve keys give 24 outer spokes (a major triad and its relative minor per
//  key); each spoke also carries its dominant seventh and its leading-tone
//  diminished. Edges encode four motions plus hidden secondary dominants.
//
//  WHEEL GEOMETRY   (polar: 24 spokes around, 3 rings deep)
//  ----------------------------------------------------------------------------
//      spoke s in 0..23     angle  a = -PI/2 + (s - 0.5) * TAU/24
//      ring  r in 0..2      radius R = baseR * RING[r]     RING=[1.0,0.72,0.47]
//      node position        x = cos(a)*R,  y = sin(a)*R
//
//                       ring0 outer triads (M / m)
//                      ╱  ring1 dominant  (X7)
//                     ╱  ╱  ring2 diminished (X°)
//                 ●──────────────●              a spoke is one radial line;
//                  ╲    ┌───┐    ╱              even spokes hold a major key,
//                   ●   │ + │   ●               odd spokes its relative minor.
//                    ╲  └───┘  ╱                the center + is the origin;
//                     ●───────●                 dim7 star edges cross it.
//
//  EDGE TYPES   (arrow = "wants to resolve to")
//  ----------------------------------------------------------------------------
//      res   X7 or X° ─▶ its tonic          dominant falls a fifth / lt rises
//      rel   minor    ─▶ its relative major
//      five  V triad  ─▶ I triad            adjacent step around the fifths ring
//      star  X°       ─▶ 3 more majors      dim7 is symmetric, lifts 4 ways
//      sec   I or vi  ─▶ borrowed V7s       hidden until a triad is selected
//
//  RENDER + INTERACTION
//  ----------------------------------------------------------------------------
//      pointer tap ─▶ toScreen/toWorld ─▶ nearest node ─▶ select()
//                        │                                  ├─▶ playNode() audio
//                        │                                  ├─▶ spawnComet()
//                        │                                  └─▶ pattern grid
//      requestAnimationFrame(draw): edges, comets, nodes, then the note roll
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      music data ........... "music data"       names, colours, fifths, kinds
//      graph build .......... "build graph"       generate nodes and edges
//      layout / camera ...... "layout / camera"   polar placement + pan/zoom
//      state ................ "---------- state"  selection, filters, pattern
//      focus ................ "function buildFocus"  one-key subset highlight
//      complexity tiers ..... "const TIERS"       simple/standard/full presets
//      audio ................ "voice-led pad"     lazy WebAudio graph
//      voice leading ........ "function chordMidis"  nearest-octave voicing
//      play a chord ......... "function playNode" synth + light-up + roll
//      select ............... "function select"   the tap outcome
//      sequencer ............ "pattern sequencer" the multi-line pattern grid
//      playback ............. "function advance"  step through the pattern
//      wander ............... "function wanderStep"  the rule-obeying walk
//      key strip ............ "key focus strip"   the 12-key filter row
//      piano keyboard ....... "piano keyboard"    tap-notes filter + audition
//      note timeline ........ "note timeline"     the gantt roll of voices
//      controls ............. "---------- controls"  panel wiring + shortcuts
//      pointer .............. "tap / pan / pinch" gesture handling
//      render ............... "function draw"     the per-frame canvas paint
// ============================================================================
'use strict';
/* ============================================================
   HARMONY WHEEL — chord resolution mandala
   Stella Nova · davesgames.io
   ============================================================ */

/* ---------- music data ---------- */
/* colorscale matches ChordLab: hue = pitch class * 30° */
// Note-name spellings by pitch class (sharp side and flat side of the fifths
// circle); nm() picks one. pcColor keeps each pitch class one hue everywhere.
// FIFTHS[k] is the pitch class of the major key k steps clockwise from C.
const SHARP=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const FLAT =['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const pcColor=(pc,l=64)=>'hsl('+((pc%12)*30)+',88%,'+l+'%)';
const pcColorA=(pc,a,l=64)=>'hsla('+((pc%12)*30)+',88%,'+l+'%,'+a+')';
const FIFTHS=[0,7,2,9,4,11,6,1,8,3,10,5];          // pc of major key at fifths step k
const nm=(pc,flat)=>(flat?FLAT:SHARP)[((pc%12)+12)%12];

// The four chord kinds as interval sets above the root. dim here is a full
// symmetric diminished seventh (0,3,6,9), which is why its star has four lifts.
const KIND={maj:{iv:[0,4,7]},
            min:{iv:[0,3,7]},
            dom:{iv:[0,4,7,10]},
            dim:{iv:[0,3,6,9]}};

/* ---------- build graph ---------- */
// The wheel is a small directed graph built once at load. nodes carry musical
// identity plus a spoke and ring for placement; edges carry a motion type.
const nodes=[], edges=[];
const N={};                       // id -> node
const outerMaj={}, outerMin={};   // pc -> node (for lookups)
// Create one node and index it by id and (for outer triads) by pitch class.
function addNode(id,kind,pc,label,spoke,ring){
  const n={id,kind,pc:((pc%12)+12)%12,label,spoke,ring,x:0,y:0,r:0};
  nodes.push(n); N[id]=n; return n;
}
// For each of the 12 keys, place four nodes on a major spoke and four on the
// adjacent minor spoke: the outer triad, its dominant, and its leading-tone dim.
for(let k=0;k<12;k++){
  // Spell flats from the flat half of the circle so labels read naturally.
  const flat=k>=7;
  // Major key pc and its relative minor pc (a minor third, 9 semitones, below).
  const pM=FIFTHS[k], pm=(pM+9)%12;
  // Two spokes per key: even for major, odd for the relative minor.
  const sM=2*k, sm=2*k+1;
  // outer triads
  const M=addNode('M'+pM,'maj',pM,nm(pM,flat),sM,0);
  const m=addNode('m'+pm,'min',pm,nm(pm,flat)+'m',sm,0);
  outerMaj[pM]=M; outerMin[pm]=m;
  // Ring 1 dominant is the seventh a fifth above (pc+7); ring 2 diminished is
  // the leading-tone chord a semitone below the triad root (pc+11).
  // each spoke's own dominant (V7 of that triad) and leading-tone dim
  addNode('D'+sM,'dom',(pM+7)%12,nm((pM+7)%12,flat)+'7',sM,1);
  addNode('D'+sm,'dom',(pm+7)%12,nm((pm+7)%12,flat)+'7',sm,1);
  addNode('o'+sM,'dim',(pM+11)%12,nm((pM+11)%12,flat)+'°',sM,2);
  addNode('o'+sm,'dim',(pm+11)%12,nm((pm+11)%12,flat)+'°',sm,2);
}
// The outer triad on a given spoke; the resolution target for that spoke.
const spokeOuter=s=>nodes.find(n=>n.spoke===s&&n.ring===0);
// Add a directed edge a->b of motion type t; hidden edges show only on select.
function addEdge(a,b,t,hidden){edges.push({a,b,t,hidden:!!hidden});}
// Resolution edges: each spoke's dominant and diminished both point to its tonic.
for(let s=0;s<24;s++){
  const tgt=spokeOuter(s);
  addEdge(N['D'+s],tgt,'res');   // V7 -> I
  addEdge(N['o'+s],tgt,'res');   // vii° -> I
}
// Outer-ring edges: relative minor to its major, and each V triad to its I one
// step around the fifths circle.
for(let k=0;k<12;k++){
  const pM=FIFTHS[k], pm=(pM+9)%12;
  addEdge(outerMin[pm],outerMaj[pM],'rel');                 // relative minor -> major
  addEdge(outerMaj[FIFTHS[(k+1)%12]],outerMaj[pM],'five');  // V triad -> I triad
}
// dim7 symmetry star: each ° also lifts into the majors a half step above its other 3 tones
// A dim7 stacks minor thirds, so its four notes are interchangeable roots; each
// can rise a semitone into a major triad. These are the long center-crossing lines.
for(let s=0;s<24;s++){
  const d=N['o'+s];
  for(let n=1;n<4;n++){
    const tpc=(d.pc+1+3*n)%12;
    if(outerMaj[tpc]) addEdge(d,outerMaj[tpc],'star');
  }
}
// secondary dominants (hidden until a triad is selected): I -> V7-of-{ii,iii,IV,V,vi}
// dia lists the five diatonic chords a key can borrow a dominant for (ii iii IV
// V vi by scale degree). Each edge points the tonic at that chord's own V7.
for(let k=0;k<12;k++){
  const pM=FIFTHS[k], M=outerMaj[pM];
  const dia=[{pc:(pM+2)%12,min:true},{pc:(pM+4)%12,min:true},{pc:(pM+5)%12,min:false},
             {pc:(pM+7)%12,min:false},{pc:(pM+9)%12,min:true}];
  for(const d of dia){
    const spk=(d.min?outerMin[d.pc]:outerMaj[d.pc]).spoke;
    addEdge(M,N['D'+spk],'sec',true);
  }
  const pm=(pM+9)%12, m=outerMin[pm];
  addEdge(m,N['D'+outerMaj[pM].spoke],'sec',true);          // vi -> V7 of relative major
}
// Adjacency lists: outgoing and incoming edges per node id, so select() and the
// renderer can find a node's arrows without scanning every edge.
const outE={},inE={};
for(const n of nodes){outE[n.id]=[];inE[n.id]=[];}
for(const e of edges){outE[e.a.id].push(e);inE[e.b.id].push(e);}

/* ---------- layout / camera ---------- */
const cvs=document.getElementById('wheel'), ctx=cvs.getContext('2d');
let W=0,H=0,DPR=1;
// Pan/zoom camera in world units; toScreen/toWorld convert with it.
const cam={x:0,y:0,z:1};
// Radius multiplier and node-radius multiplier per ring (0 outer .. 2 inner);
// the active complexity tier overwrites these.
let RING=[1.0,0.72,0.47];
let NR=[0.075,0.062,0.055];
// Complexity presets: which layers and secondary dominants show, the ring/node
// scales, and the panel hint plus status tag for each.
const TIERS={
  simple:  {layers:{dom:true,dim:false,star:false,outer:true}, sec:false,
            ring:[1.0,0.60,0.42], nr:[0.088,0.074,0.055],
            hint:'Triads and their dominants. One idea: <b>V7 falls a fifth, home.</b>',
            tag:'SIMPLE · triads + dominants'},
  standard:{layers:{dom:true,dim:true,star:false,outer:true}, sec:true,
            ring:[1.0,0.72,0.47], nr:[0.075,0.062,0.055],
            hint:'Adds the leading-tone ° ring and, on tap, secondary dominants.',
            tag:'STANDARD · + leading tones'},
  full:    {layers:{dom:true,dim:true,star:true,outer:true}, sec:true,
            ring:[1.0,0.72,0.47], nr:[0.075,0.062,0.055],
            hint:'Everything — including the dim7 symmetry star crossing the center.',
            tag:'FULL · + dim7 symmetry'}
};
let complexity='standard', secEnabled=true;
let baseR=300;
const TAU=Math.PI*2;
// Place every node in world space from its spoke angle and ring radius. Spoke 0
// starts just left of straight up (-PI/2), stepping TAU/24 per spoke clockwise.
function layout(){
  for(const n of nodes){
    const a=-Math.PI/2+(n.spoke-0.5)*TAU/24;
    const R=baseR*RING[n.ring];
    n.x=Math.cos(a)*R; n.y=Math.sin(a)*R;
    n.r=baseR*NR[n.ring];
  }
}
// Match the canvas backing store to the window and device pixel ratio, size the
// wheel to 40% of the smaller edge, then re-place the nodes.
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth; H=window.innerHeight;
  cvs.width=W*DPR; cvs.height=H*DPR;
  cvs.style.width=W+'px'; cvs.style.height=H+'px';
  baseR=Math.min(W,H)*0.40;
  layout();
}
window.addEventListener('resize',resize); resize();
/* iframes can be 0-sized at load inside the index shell — recover when real size arrives */
if(window.ResizeObserver) new ResizeObserver(resize).observe(document.documentElement);
if(window.visualViewport) visualViewport.addEventListener('resize',resize);
// World<->screen transforms; the inverse of the translate/scale used in draw().
const toScreen=(x,y)=>[(x+cam.x)*cam.z+W/2,(y+cam.y)*cam.z+H/2];
const toWorld =(sx,sy)=>[(sx-W/2)/cam.z-cam.x,(sy-H/2)/cam.z-cam.y];

/* ---------- state ---------- */
// Which node rings/edge layers are visible right now.
const layers={dom:true,dim:true,star:true,outer:true};
let keyFocus=-1;                  // pc of focused major key, -1 = all
let focusSet=null;
let noteFilter=new Set();         // selected pitch classes from the keyboard
// True when chord n contains every pitch class in set (used by the note filter).
function chordHasAll(n,set){
  const iv=KIND[n.kind].iv;
  for(const pc of set){
    let ok=false;
    for(const i of iv){ if((n.pc+i)%12===pc){ok=true;break;} }
    if(!ok) return false;
  }
  return true;
}
// Current selection and interaction mode; the pattern is an array of lines,
// each a repeat count plus a list of {node, beats} cells. Playback cursors and
// transient visual state (comets, node flashes) live alongside.
let sel=null;
let mode='explore';
let lines=[{reps:1,cells:[]}];    // pattern: lines of {n,beats} cells
let activeLine=0;
let playLi=0, playRep=0, playCi=-1, lastPlayed=null;
let comets=[];                    // {e,t0,dur}
let flash={};                     // nodeId -> until-timestamp
let wanderTimer=null, playTimer=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

// Build the highlight subset for one major key: its tonic plus the diatonic
// chords and their dominants/diminished. Dimming everything else focuses the key.
function buildFocus(pc){
  if(pc<0){focusSet=null;return;}
  const S=new Set();
  const M=outerMaj[pc]; S.add(M.id);
  S.add(N['D'+M.spoke].id); S.add(N['o'+M.spoke].id);
  const dia=[{pc:(pc+2)%12,min:1},{pc:(pc+4)%12,min:1},{pc:(pc+5)%12,min:0},
             {pc:(pc+7)%12,min:0},{pc:(pc+9)%12,min:1}];
  for(const d of dia){
    const n=d.min?outerMin[d.pc]:outerMaj[d.pc];
    S.add(n.id); S.add(N['D'+n.spoke].id); S.add(N['o'+n.spoke].id);
  }
  focusSet=S;
}
// A node shows unless its ring's layer is switched off (ring 0 always shows).
const nodeVisible=n=>
  (n.ring!==1||layers.dom)&&(n.ring!==2||layers.dim);
// An edge shows only when its type's layer is on and both endpoints are visible.
function edgeVisible(e){
  if(e.t==='sec'&&!secEnabled) return false;
  if(e.t==='star'&&!layers.star) return false;
  if((e.t==='rel'||e.t==='five')&&!layers.outer) return false;
  if(!nodeVisible(e.a)||!nodeVisible(e.b)) return false;
  return true;
}
// Apply a complexity preset: copy its layers, ring scales and flags, re-layout,
// and sync the tier buttons, layer toggles, hint text and status tag.
function setComplexity(c){
  complexity=c;
  const T=TIERS[c];
  Object.assign(layers,T.layers);
  secEnabled=T.sec; RING=T.ring; NR=T.nr;
  layout();
  document.querySelectorAll('#tiers button').forEach(b=>b.classList.toggle('on',b.dataset.tier===c));
  document.querySelectorAll('.tgl').forEach(t=>t.classList.toggle('on',!!layers[t.dataset.layer]));
  document.getElementById('tierHint').innerHTML=T.hint;
  document.getElementById('fnRight').textContent=T.tag;
  if(sel&&!nodeVisible(sel)) sel=null;
}
// A node counts as in focus when no key is chosen or it is in the focus subset.
const inFocus=n=>!focusSet||focusSet.has(n.id);

/* ---------- audio: voice-led pad ---------- */
// The shared audio graph, built lazily on first sound (browsers gate audio on a
// user gesture). master -> compressor -> destination, with a filtered feedback
// delay tapped off delaySend for space.
let AC=null, master=null, delaySend=null;
// Create the audio graph once, or just resume it if it already exists.
function audio(){
  if(AC) {if(AC.state==='suspended')AC.resume(); return;}
  AC=new (window.AudioContext||window.webkitAudioContext)();
  const comp=AC.createDynamicsCompressor();
  comp.threshold.value=-20; comp.ratio.value=5;
  master=AC.createGain(); master.gain.value=vol.value/100*0.9;
  master.connect(comp); comp.connect(AC.destination);
  // filtered feedback delay for space
  const dl=AC.createDelay(1.2); dl.delayTime.value=0.28;
  const fb=AC.createGain(); fb.gain.value=0.34;
  const dlp=AC.createBiquadFilter(); dlp.type='lowpass'; dlp.frequency.value=1400;
  dl.connect(dlp); dlp.connect(fb); fb.connect(dl);
  const wet=AC.createGain(); wet.gain.value=0.5;
  dlp.connect(wet); wet.connect(master);
  delaySend=AC.createGain(); delaySend.gain.value=0.4; delaySend.connect(dl);
}
// Previous voicing, kept so the next chord can move each voice as little as
// possible (voice leading), which is what makes the pad sound smooth.
let lastBass=null, lastUppers=null;
// Voice a chord into MIDI notes: a bass root chosen for least motion and low
// gravity, then each chord tone placed in the octave nearest an existing voice.
function chordMidis(n){
  const iv=KIND[n.kind].iv;
  // bass: root, minimal motion from previous bass + gravity toward low register
  // Score a candidate bass by distance from the last bass plus a mild pull to
  // MIDI 41; pick the root octave (pc+36 or pc+48) with the lower score.
  const bref=(lastBass==null)?43:lastBass;
  const sc=m=>Math.abs(m-bref)+0.35*Math.abs(m-41);
  const bass=(sc(n.pc+36)<=sc(n.pc+48))?n.pc+36:n.pc+48;
  // uppers: each chord tone takes the octave nearest an existing voice
  const prev=(lastUppers&&lastUppers.length)?lastUppers:[62,66,69];
  const uppers=[];
  for(const i of iv){
    const pc=(n.pc+i)%12;
    let best=null,bd=1e9;
    // Try every octave of this tone in a comfortable range; keep the one closest
    // to a previous voice, with a heavy penalty against doubling a voice.
    for(let m=pc+48;m<=pc+84;m+=12){
      if(m<56||m>81) continue;
      let d=Math.min.apply(null,prev.map(p=>Math.abs(p-m)));
      if(uppers.indexOf(m)>=0) d+=100;
      if(d<bd){bd=d;best=m;}
    }
    uppers.push(best);
  }
  lastBass=bass; lastUppers=uppers.slice();
  return [bass].concat(uppers);
}
// Timer that clears the keyboard's play highlight after a chord fades.
let kbTimer=null;
// Sound one chord: open a per-chord swelling low-pass, then for each voice run a
// short attack, gentle settle and long release so consecutive chords overlap.
// Also flashes the node, lights the keyboard, and pushes bars into the roll.
function playNode(n,dur){
  audio(); if(!AC) return;
  dur=dur||1.9;
  const t=AC.currentTime;
  const lp=AC.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=0.6;
  lp.frequency.setValueAtTime(650,t);
  lp.frequency.linearRampToValueAtTime(2300,t+0.35);
  lp.frequency.setTargetAtTime(1250,t+0.5,0.7);
  lp.connect(master); lp.connect(delaySend);
  const midis=chordMidis(n);
  midis.forEach((m,idx)=>{
    const f=440*Math.pow(2,(m-69)/12);
    // Bass is one triangle; upper voices stack a detuned saw and triangle for
    // width. Each triple is [waveform, detune cents, peak gain].
    const voices=idx===0?[['triangle',0,0.085]]:[['sawtooth',-6,0.026],['triangle',6,0.048]];
    for(const v of voices){
      const o=AC.createOscillator(), g=AC.createGain();
      o.type=v[0]; o.frequency.value=f; o.detune.value=v[1];
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(v[2],t+0.14);          // slow attack
      g.gain.setTargetAtTime(v[2]*0.8,t+0.3,0.6);           // gentle settle
      g.gain.setTargetAtTime(0,t+dur,0.35);                 // long release: chords overlap
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t+dur+2.2);
    }
  });
  flash[n.id]=performance.now()+520;
  kbLight(midis,dur);
  rollPush(midis,dur);
}

/* ---------- interaction helpers ---------- */
// Plain-language function of a chord for the status line: what it is and where
// it resolves, phrased per kind (dominant, diminished, minor, or tonic major).
function funcText(n){
  const flat=Math.floor(n.spoke/2)>=7;
  if(n.kind==='dom'){
    const t=spokeOuter(n.spoke);
    return n.label+' · dominant → resolves down a fifth to '+t.label;
  }
  if(n.kind==='dim'){
    const t=spokeOuter(n.spoke);
    const alts=[1,2,3].map(k=>nm((n.pc+1+3*k)%12,flat)).join(' / ');
    return n.label+' · leading tone → rises to '+t.label+'  (dim7 also lifts to '+alts+')';
  }
  if(n.kind==='min'){
    const rel=nm((n.pc+3)%12,flat);
    return n.label+' · relative minor of '+rel+' — its V7 is '+nm((n.pc+7)%12,flat)+'7';
  }
  return secEnabled
    ? n.label+' major · tonic — lit arrows are its secondary dominants'
    : n.label+' major · tonic — its V7 is '+nm((n.pc+7)%12,flat)+'7';
}
// Select a chord: make it the highlight source, update the status text, play it,
// send a comet along the arrow it was reached by, and in Explore append it to
// the active pattern line.
function select(n,fromNode){
  sel=n;
  document.getElementById('fnMain').textContent=funcText(n);
  playNode(n);
  if(fromNode){
    const e=outE[fromNode.id].find(e=>e.b===n);
    if(e) spawnComet(e);
  }
  if(mode==='explore'){lines[activeLine].cells.push({n:n,beats:2}); renderGrid();}
}
// Queue a comet to travel an edge, unless reduced-motion is requested.
function spawnComet(e){
  if(reduced) return;
  comets.push({e,t0:performance.now(),dur:620});
}

/* ---------- pattern sequencer ---------- */
// The pattern grid: each line is a row of chord cells with beat lengths and a
// repeat count. Tapping a cell cycles its length through BEATS; the line's ×N
// button cycles its repeats through REPS.
const seqbody=document.getElementById('seqbody');
const BEATS=[2,4,0.5,1];          // tap-cycle order
const REPS=[1,2,4,8];
let loop=false;
const beatTxt=b=>b===0.5?'½':String(b);
// Rebuild the whole grid DOM from the lines model. Called after every edit.
function renderGrid(){
  seqbody.innerHTML='';
  lines.forEach((L,li)=>{
    const row=document.createElement('div');
    row.className='line'+(li===activeLine?' active':'');
    row.onclick=e=>{
      if(e.target.closest('.cell,.lbtn')) return;
      activeLine=li; renderGrid();
    };
    // Per-line header buttons: number/select, repeat count, duplicate, delete.
    const head=document.createElement('div'); head.className='lhead';
    const mk=(txt,title,fn,cls)=>{
      const b=document.createElement('button');
      b.className='lbtn'+(cls?' '+cls:''); b.textContent=txt; b.title=title;
      b.onclick=e=>{e.stopPropagation();fn();}; head.appendChild(b);
    };
    mk(String(li+1),'Select line',()=>{activeLine=li;renderGrid();},'lnum');
    mk('×'+L.reps,'Repeat count',()=>{L.reps=REPS[(REPS.indexOf(L.reps)+1)%REPS.length];renderGrid();});
    mk('⧉','Duplicate line',()=>{
      lines.splice(li+1,0,{reps:L.reps,cells:L.cells.map(c=>({n:c.n,beats:c.beats}))});
      activeLine=li+1; renderGrid();
    });
    mk('✕','Delete line',()=>{
      lines.splice(li,1);
      if(!lines.length) lines=[{reps:1,cells:[]}];
      activeLine=Math.min(activeLine,lines.length-1);
      renderGrid();
    });
    row.appendChild(head);
    // The chord cells; an empty line prompts to tap the wheel.
    const wrap=document.createElement('div'); wrap.className='lcells';
    if(!L.cells.length){
      const em=document.createElement('span'); em.className='empty';
      em.textContent=li===activeLine?'TAP THE WHEEL':'—';
      wrap.appendChild(em);
    }
    L.cells.forEach((c,ci)=>{
      const cell=document.createElement('div');
      cell.className='cell'+((playTimer&&li===playLi&&ci===playCi)?' playing':'');
      cell.style.color=pcColor(c.n.pc,64); cell.style.borderColor=pcColorA(c.n.pc,0.45);
      cell.innerHTML=c.n.label+'<span class="b">'+beatTxt(c.beats)+'</span><span class="x">×</span>';
      cell.title='Tap: change length · ×: remove';
      cell.onclick=e=>{
        e.stopPropagation();
        // The × glyph removes the cell; the body cycles its beat length.
        if(e.target.classList.contains('x')){L.cells.splice(ci,1);renderGrid();return;}
        c.beats=BEATS[(BEATS.indexOf(c.beats)+1)%BEATS.length]; renderGrid();
      };
      wrap.appendChild(cell);
    });
    row.appendChild(wrap);
    seqbody.appendChild(row);
  });
}
// Transport buttons: add line, remove last chord, clear all, toggle loop.
document.getElementById('addLine').onclick=()=>{
  lines.push({reps:1,cells:[]}); activeLine=lines.length-1; renderGrid();
};
document.getElementById('undoBtn').onclick=()=>{lines[activeLine].cells.pop();renderGrid();};
document.getElementById('clearBtn').onclick=()=>{
  stopPlayback(); lines=[{reps:1,cells:[]}]; activeLine=0; renderGrid();
};
document.getElementById('loopBtn').onclick=()=>{
  loop=!loop; loopBtn.classList.toggle('on',loop);
};
// Total chord count across all lines; playback and the play button gate on it.
const totalCells=()=>lines.reduce((a,l)=>a+l.cells.length,0);
// Stop playback and reset the play cursors to the start.
function stopPlayback(){
  if(playTimer){clearTimeout(playTimer);playTimer=null;}
  playLi=0; playRep=0; playCi=-1; lastPlayed=null;
  playBtn.textContent='▶'; renderGrid();
}
// Move the play cursor to the next cell, honouring each line's repeat count and
// the global loop flag. The guard counter stops an infinite spin over empty
// lines. Returns false when the pattern has ended.
function advance(){
  for(let guard=0;guard<2048;guard++){
    playCi++;
    const L=lines[playLi];
    if(L&&playCi<L.cells.length) return true;
    playCi=-1; playRep++;
    if(L&&L.cells.length&&playRep<L.reps) continue;
    playRep=0; playLi++;
    if(playLi>=lines.length){
      if(loop&&totalCells()) playLi=0;
      else return false;
    }
  }
  return false;
}
// Play the cell at the cursor, draw its comet from the previous chord, then set
// a timer for its beat duration to advance and repeat, or stop at the end.
function scheduleStep(){
  const c=lines[playLi].cells[playCi];
  // Beat length in ms from the tempo (BPM); notes last slightly longer for legato.
  const ms=c.beats*60000/(+tempo.value);
  playNode(c.n, ms/1000*1.08);                       // slight overlap → legato flow
  if(lastPlayed&&lastPlayed!==c.n){
    const e=outE[lastPlayed.id].find(e=>e.b===c.n); if(e)spawnComet(e);
  }
  lastPlayed=c.n;
  renderGrid();
  playTimer=setTimeout(()=>{ if(advance()) scheduleStep(); else stopPlayback(); },ms);
}
// Play/stop toggle: start from the top of the pattern or halt if already running.
document.getElementById('playBtn').onclick=()=>{
  if(playTimer){stopPlayback();return;}
  if(!totalCells()) return;
  audio(); playBtn.textContent='■';
  playLi=0; playRep=0; playCi=-1; lastPlayed=null;
  if(advance()) scheduleStep(); else stopPlayback();
};
renderGrid();

/* ---------- wander ---------- */
// One step of the random walk: from the current chord, resolve dominants and
// diminished home (a dim7 sometimes takes a symmetric star lift), and let tonics
// reach for a secondary dominant or an outer-ring move. Weighted by chance.
function wanderStep(){
  let cur=sel;
  if(!cur) cur=outerMaj[0];
  let next=null;
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  if(cur.kind==='dom'||cur.kind==='dim'){
    next=spokeOuter(cur.spoke);                       // resolve home
    if(cur.kind==='dim'&&Math.random()<0.25){
      const st=outE[cur.id].filter(e=>e.t==='star'&&edgeVisible(e));
      if(st.length) next=pick(st).b;                  // symmetric surprise
    }
  }else{
    const r=Math.random();
    const secs=outE[cur.id].filter(e=>e.t==='sec'&&edgeVisible(e));
    const outs=outE[cur.id].filter(e=>(e.t==='rel'||e.t==='five')&&edgeVisible(e));
    if(r<0.62&&secs.length) next=pick(secs).b;
    else if(outs.length) next=pick(outs).b;
    else if(secs.length) next=pick(secs).b;
  }
  if(!next) next=outerMaj[Math.floor(Math.random()*12)];
  const e=outE[cur.id].find(e=>e.b===next); if(e)spawnComet(e);
  sel=next;
  document.getElementById('fnMain').textContent='WANDER · '+funcText(next);
  playNode(next,(60000/(+tempo.value)*2)/1000*1.05);
}
// Switch between Explore (taps build the pattern) and Wander (auto random walk);
// starts or clears the wander interval and updates the hint text.
function setMode(m){
  mode=m;
  mExplore.classList.toggle('on',m==='explore');
  mWander.classList.toggle('on',m==='wander');
  document.getElementById('modeHint').innerHTML= m==='explore'
    ?'<b>Explore:</b> tap a chord to hear it and light up every place it can resolve. Taps fill the active line in the pattern grid.'
    :'<b>Wander:</b> a random walk that obeys the arrows — dominants resolve, tonics reach for secondary dominants. Sit back.';
  if(wanderTimer){clearInterval(wanderTimer);wanderTimer=null;}
  if(m==='wander'){audio(); wanderStep(); wanderTimer=setInterval(wanderStep,60000/(+tempo.value)*2);}
}
mExplore.onclick=()=>setMode('explore');
mWander.onclick=()=>setMode('wander');

/* ---------- key focus strip ---------- */
// The row of key buttons across the top, in fifths order. Choosing one dims the
// wheel to that key's chords via buildFocus(); ALL clears the focus.
const keystrip=document.getElementById('keystrip');
keystrip.innerHTML='<button class="kf on" data-pc="-1">ALL</button>'+FIFTHS.map((pc,k)=>
  '<button class="kf" data-pc="'+pc+'" style="--kc:'+pcColor(pc,60)+'">'+nm(pc,k>=7)+'</button>').join('');
keystrip.querySelectorAll('.kf').forEach(b=>{
  b.onclick=()=>{
    keyFocus=+b.dataset.pc; buildFocus(keyFocus);
    keystrip.querySelectorAll('.kf').forEach(x=>x.classList.toggle('on',x===b));
  };
});

/* ---------- piano keyboard ---------- */
// A two-octave keyboard. Tapping keys builds a pitch-class filter that dims every
// wheel chord not containing all the picked notes; it also auditions each note.
const KB_LOW=48, KB_HIGH=71;                 // C3..B4
const kb=document.getElementById('kb');
const keyEls={};                             // midi -> element
// Build the keys: white keys flow left to right; black keys are positioned by
// percent over the gap after their preceding white key.
(function buildKB(){
  const WPCT=100/14, isBlack=pc=>[1,3,6,8,10].indexOf(pc)>=0;
  let whites=0;
  for(let m=KB_LOW;m<=KB_HIGH;m++){
    const pc=m%12;
    if(!isBlack(pc)){
      const k=document.createElement('div');
      k.className='wk'; k.dataset.midi=m; k.dataset.pc=pc;
      k.style.setProperty('--kc',pcColor(pc,58));
      kb.appendChild(k); keyEls[m]=k; whites++;
    }else{
      const k=document.createElement('div');
      k.className='bk'; k.dataset.midi=m; k.dataset.pc=pc;
      k.style.setProperty('--kc',pcColor(pc,44));
      k.style.left=(whites*WPCT-WPCT*0.31)+'%';
      kb.appendChild(k); keyEls[m]=k;
    }
  }
})();
// How many visible chords contain every filtered note; -1 when none are picked.
function kbMatchCount(){
  if(!noteFilter.size) return -1;
  let c=0;
  for(const n of nodes) if(nodeVisible(n)&&chordHasAll(n,noteFilter)) c++;
  return c;
}
// Update the keyboard caption: the prompt, or the picked notes and match count.
function kbLabel(){
  const el=document.getElementById('kbCount');
  if(!noteFilter.size){el.textContent='TAP KEYS TO FILTER THE WHEEL BY NOTE';return;}
  const names=[...noteFilter].map(pc=>nm(pc,false)).join(' + ');
  el.textContent=names+'  →  '+kbMatchCount()+' CHORDS CONTAIN THEM';
}
// Key tap: toggle that pitch class in the filter, restyle the keys, refresh the
// caption, and play the single note.
kb.addEventListener('click',e=>{
  const t=e.target.closest('.wk,.bk'); if(!t) return;
  const pc=+t.dataset.pc;
  if(noteFilter.has(pc)) noteFilter.delete(pc); else noteFilter.add(pc);
  for(const m in keyEls) keyEls[m].classList.toggle('selq',noteFilter.has(+m%12));
  kbLabel();
  audio();
  if(AC){ // audition the single note
    const f=440*Math.pow(2,(+t.dataset.midi-69)/12);
    const o=AC.createOscillator(),g=AC.createGain();
    o.type='triangle';o.frequency.value=f;
    g.gain.setValueAtTime(0,AC.currentTime);
    g.gain.linearRampToValueAtTime(0.09,AC.currentTime+0.02);
    g.gain.setTargetAtTime(0,AC.currentTime+0.25,0.12);
    o.connect(g);g.connect(master);o.start();o.stop(AC.currentTime+1);
  }
});
// Clear the note filter and its key highlights.
document.getElementById('kbClear').onclick=()=>{
  noteFilter.clear();
  for(const m in keyEls) keyEls[m].classList.remove('selq');
  kbLabel();
};
// Flash the keys of a sounding chord: fold each MIDI note into the visible range
// and add the play class, cleared after the chord's duration.
function kbLight(midis,dur){
  if(kbTimer){clearTimeout(kbTimer);}
  for(const m in keyEls) keyEls[m].classList.remove('play');
  for(let m of midis){
    while(m<KB_LOW)m+=12; while(m>KB_HIGH)m-=12;
    keyEls[m].classList.add('play');
  }
  kbTimer=setTimeout(()=>{for(const m in keyEls) keyEls[m].classList.remove('play');},dur*860);
}

/* ---------- note timeline: gantt of sounding voices ---------- */
// A scrolling gantt of the five voices (bass + up to four uppers). Each played
// chord pushes a bar per voice; a voice that holds its pitch extends one bar.
const rollC=document.getElementById('roll'), rollX=rollC.getContext('2d');
const rollRows=[[],[],[],[],[]];        // BASS,V1..V4 · bars {midi,t0,t1}
const ROLL_PPS=34, ROLL_KEEP=30;        // px per second · seconds retained
const ROLL_NAMES=['BASS','V1','V2','V3','V4'];
// Append this chord's voices to their rows; extend the previous bar when a voice
// repeats its pitch (so a held note reads as one unbroken bar), then drop bars
// older than the retention window.
function rollPush(midis,dur){
  const now=performance.now();
  // Keep bass in row 0; sort the upper voices low to high into rows V1..V4.
  const voices=[midis[0]].concat(midis.slice(1).slice().sort((a,b)=>a-b));
  voices.forEach((m,i)=>{
    if(i>=rollRows.length) return;
    const row=rollRows[i], last=row[row.length-1];
    if(last&&last.midi===m&&now<=last.t1+140){last.t1=now+dur*1000;return;}   // held voice → one bar
    row.push({midi:m,t0:now,t1:now+dur*1000});
  });
  for(const row of rollRows) while(row.length&&row[0].t1<now-ROLL_KEEP*1000) row.shift();
}
// Paint the roll each frame: row labels and lanes, a tempo beat grid, then every
// bar mapped from time to x (now is the right edge), and the now line.
function drawRoll(now){
  const w=rollC.clientWidth,h=rollC.clientHeight;
  if(w<40||h<30) return;
  const dpr=Math.min(devicePixelRatio||1,2);
  if(rollC.width!==Math.round(w*dpr)){rollC.width=Math.round(w*dpr);rollC.height=Math.round(h*dpr);}
  rollX.setTransform(dpr,0,0,dpr,0,0);
  rollX.clearRect(0,0,w,h);
  const L=36,R=w-8;
  const rows=rollRows.length, rh=h/rows;
  rollX.textBaseline='middle';
  for(let r=0;r<rows;r++){
    const yc=h-(r+0.5)*rh;
    rollX.font='600 8px "JetBrains Mono",monospace';
    rollX.fillStyle='rgba(106,118,144,0.6)'; rollX.textAlign='left';
    rollX.fillText(ROLL_NAMES[r],4,yc);
    rollX.strokeStyle='rgba(150,200,255,0.06)'; rollX.lineWidth=1;
    rollX.beginPath();rollX.moveTo(L,h-(r+1)*rh);rollX.lineTo(R,h-(r+1)*rh);rollX.stroke();
  }
  // beat grid at current tempo
  const beat=60/(+tempo.value), bpx=beat*ROLL_PPS;
  if(bpx>7){
    const off=((now/1000)%beat)*ROLL_PPS;
    for(let x=R-off;x>L;x-=bpx){
      rollX.strokeStyle='rgba(150,200,255,0.07)';
      rollX.beginPath();rollX.moveTo(x,2);rollX.lineTo(x,h-2);rollX.stroke();
    }
  }
  // bars
  let any=false;
  rollX.textAlign='center';
  rollRows.forEach((row,r)=>{
    const y=h-(r+1)*rh+2, bh=Math.max(6,rh-4);
    for(const b of row){
      // Map each bar's start/end time to x; older time is further left.
      const x0=Math.max(L,R-(now-b.t0)/1000*ROLL_PPS);
      const x1=Math.min(R,R-(now-b.t1)/1000*ROLL_PPS);
      if(x1<=L) continue;
      any=true;
      const pc=((b.midi%12)+12)%12, live=now<b.t1;
      rollX.fillStyle=pcColorA(pc,live?0.85:0.5,52);
      rollX.strokeStyle=pcColor(pc,62); rollX.lineWidth=1;
      if(live){rollX.shadowColor=pcColor(pc,60);rollX.shadowBlur=8;}
      rollX.beginPath();
      if(rollX.roundRect) rollX.roundRect(x0,y,Math.max(2,x1-x0),bh,3);
      else rollX.rect(x0,y,Math.max(2,x1-x0),bh);
      rollX.fill(); rollX.shadowBlur=0; rollX.stroke();
      if(x1-x0>30){
        rollX.fillStyle='#0e1118';
        rollX.font='700 8.5px "JetBrains Mono",monospace';
        rollX.fillText(nm(pc,false)+(Math.floor(b.midi/12)-1),(x0+x1)/2,y+bh/2+0.5);
      }
    }
  });
  if(!any){
    rollX.font='italic 500 11px "Cormorant Garamond",serif';
    rollX.fillStyle='rgba(106,118,144,0.7)'; rollX.textAlign='left';
    rollX.fillText('chords you play draw their voices here — a held tone is one unbroken bar',L+6,h/2);
  }
  // now line
  rollX.strokeStyle='rgba(232,236,244,0.35)';
  rollX.beginPath();rollX.moveTo(R,2);rollX.lineTo(R,h-2);rollX.stroke();
}

/* ---------- controls ---------- */
// Complexity tier buttons.
document.querySelectorAll('#tiers button').forEach(b=>{
  b.onclick=()=>{setComplexity(b.dataset.tier); kbLabel();};
});
// Default to the full wheel at load.
setComplexity('full');
// Individual layer toggles override the tier's layer choices.
document.querySelectorAll('.tgl').forEach(t=>{
  t.onclick=()=>{t.classList.toggle('on'); layers[t.dataset.layer]=t.classList.contains('on'); kbLabel();};
});
// Tempo and volume sliders; fillSlider paints the filled track portion.
const tempo=document.getElementById('tempo'), vol=document.getElementById('vol');
function fillSlider(s){s.style.setProperty('--fill',((s.value-s.min)/(s.max-s.min)*100)+'%');}
tempo.oninput=()=>{tempoVal.textContent=tempo.value;fillSlider(tempo);
  if(wanderTimer){clearInterval(wanderTimer);wanderTimer=setInterval(wanderStep,60000/(+tempo.value)*2);}};
vol.oninput=()=>{volVal.textContent=vol.value+'%';fillSlider(vol); if(master)master.gain.value=vol.value/100*0.9;};
fillSlider(tempo);fillSlider(vol);
document.getElementById('theoryHead').onclick=()=>{
  const t=document.getElementById('theory'); t.classList.toggle('open');
  theoryArrow.textContent=t.classList.contains('open')?'▾':'▸';
};
// Setup panel open/close and pattern-strip collapse.
document.getElementById('hamburger').onclick=()=>panel.classList.toggle('open');
document.getElementById('panelClose').onclick=()=>panel.classList.remove('open');
document.getElementById('seqTitle').onclick=()=>document.getElementById('seq').classList.toggle('min');
/* keyboard shortcuts */
// Backspace/Delete removes the last chord; Space toggles play. Ignored while a
// form field has focus.
window.addEventListener('keydown',e=>{
  const tag=(e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='select'||tag==='textarea') return;
  if(e.key==='Backspace'||e.key==='Delete'){
    e.preventDefault();
    lines[activeLine].cells.pop(); renderGrid();
  }else if(e.key===' '&&tag!=='button'){
    e.preventDefault();
    document.getElementById('playBtn').click();
  }
});

/* ---------- pointer: tap / pan / pinch / zoom ---------- */
// Unified pointer handling. One pointer pans (or taps when it did not move); two
// pointers pinch-zoom. ptrs tracks active pointers; moved distinguishes tap from
// drag; lastTap detects a double-tap to reset the camera.
const ptrs=new Map(); let panStart=null,pinchStart=null,moved=false,lastTap=0;
// Pointer down: capture it, record the pan origin, and on the second pointer
// record the pinch baseline distance and midpoint.
cvs.addEventListener('pointerdown',e=>{
  cvs.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  moved=false;
  if(ptrs.size===1) panStart={x:e.clientX,y:e.clientY,cx:cam.x,cy:cam.y};
  if(ptrs.size===2){
    const p=[...ptrs.values()];
    pinchStart={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),z:cam.z,
                mx:(p[0].x+p[1].x)/2,my:(p[0].y+p[1].y)/2};
  }
});
// Pointer move: pan with one pointer past a 7px dead zone, or pinch-zoom with two.
cvs.addEventListener('pointermove',e=>{
  if(!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===1&&panStart){
    const dx=e.clientX-panStart.x, dy=e.clientY-panStart.y;
    // A small threshold so a shaky tap is not treated as a drag.
    if(Math.hypot(dx,dy)>7){moved=true;cvs.classList.add('dragging');}
    if(moved){cam.x=panStart.cx+dx/cam.z; cam.y=panStart.cy+dy/cam.z;}
  }else if(ptrs.size===2&&pinchStart){
    moved=true;
    const p=[...ptrs.values()];
    const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    zoomAt(pinchStart.mx,pinchStart.my,pinchStart.z*(d/pinchStart.d)/cam.z);
  }
});
// Pointer up/cancel: a still single pointer is a tap; two quick taps (within
// 300ms) reset the camera, otherwise select the chord under the point.
function endPtr(e){
  if(ptrs.has(e.pointerId)&&ptrs.size===1&&!moved){
    const now=performance.now();
    if(now-lastTap<300){cam.x=0;cam.y=0;cam.z=1;lastTap=0;}
    else{lastTap=now; tap(e.clientX,e.clientY);}
  }
  ptrs.delete(e.pointerId); panStart=null; pinchStart=null;
  cvs.classList.remove('dragging');
}
cvs.addEventListener('pointerup',endPtr);
cvs.addEventListener('pointercancel',endPtr);
// Scroll wheel zooms about the cursor.
cvs.addEventListener('wheel',e=>{
  e.preventDefault();
  zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*0.0012));
},{passive:false});
// Zoom by factor f while keeping the screen point (sx,sy) fixed over the same
// world point; zoom is clamped to 0.5x..4x.
function zoomAt(sx,sy,f){
  const [wx,wy]=toWorld(sx,sy);
  cam.z=Math.min(4,Math.max(0.5,cam.z*f));
  cam.x=(sx-W/2)/cam.z-wx; cam.y=(sy-H/2)/cam.z-wy;
}
// Hit-test a screen point against the visible nodes and select the nearest one
// within 1.5 radii. If it is reachable from the current selection, pass that as
// the source so a comet flies along the connecting arrow.
function tap(sx,sy){
  const [wx,wy]=toWorld(sx,sy);
  let best=null,bd=1e9;
  for(const n of nodes){
    if(!nodeVisible(n)) continue;
    const d=Math.hypot(n.x-wx,n.y-wy);
    if(d<n.r*1.5&&d<bd){bd=d;best=n;}
  }
  if(best) select(best, sel&&outE[sel.id].some(e=>e.b===best)?sel:null);
}

/* ---------- render ---------- */
// Control point for the quadratic curve of an edge, chosen per motion type so
// the arrows read as a mandala: star edges bow toward the center, outer edges
// bow outward, resolutions curve into a gentle petal.
function qcurve(e){
  const a=e.a,b=e.b;
  let cx,cy;
  if(e.t==='star'){cx=(a.x+b.x)*0.5*0.35; cy=(a.y+b.y)*0.5*0.35;}
  else if(e.t==='rel'||e.t==='five'){
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    cx=mx*1.13; cy=my*1.13;
  }else if(e.t==='sec'){
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    cx=mx*0.9; cy=my*0.9;
  }else{ // res: gentle petal curve
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    const px=-(b.y-a.y),py=(b.x-a.x);
    const L=Math.hypot(px,py)||1;
    cx=mx+px/L*baseR*0.05; cy=my+py/L*baseR*0.05;
  }
  return {cx,cy};
}
// Give an edge its curve as a sampler q(t) plus control point and the trimmed
// end parameters, so the line stops at the node rims rather than the centers.
function edgePts(e){
  const {cx,cy}=qcurve(e);
  // trim endpoints to node rims along the curve
  const t0=0.06,t1=0.94;
  // Quadratic Bezier point at t between the two node centers.
  const q=t=>{
    const u=1-t;
    return [u*u*e.a.x+2*u*t*cx+t*t*e.b.x, u*u*e.a.y+2*u*t*cy+t*t*e.b.y];
  };
  return {q,cx,cy,t0,t1};
}
// Base alpha, line width and lightness per edge type. sec starts at alpha 0 so
// secondary dominants stay invisible until their tonic is selected.
const EDGE_STYLE={res:{a:0.55,w:1.2,l:62},rel:{a:0.35,w:1.0,l:58},
                  five:{a:0.22,w:1.0,l:58},star:{a:0.16,w:0.8,l:52},
                  sec:{a:0.0,w:1.1,l:62}};
// The per-frame paint: center cross, all edges with selection/focus/filter
// dimming and arrowheads, comets, then nodes, then the note roll. Wrapped so one
// bad frame cannot kill the animation loop.
function draw(now){
  try{
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2,H/2); ctx.scale(cam.z,cam.z); ctx.translate(cam.x,cam.y);
  // center cross
  ctx.strokeStyle='rgba(242,221,171,0.5)'; ctx.lineWidth=1/cam.z;
  ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(9,0);ctx.moveTo(0,-9);ctx.lineTo(0,9);ctx.stroke();

  // Edge index sets leaving and entering the selection, for highlighting.
  const hiOut = sel?new Set(outE[sel.id].filter(edgeVisible).map(e=>edges.indexOf(e))):null;
  const hiIn  = sel?new Set(inE[sel.id].filter(edgeVisible).map(e=>edges.indexOf(e))):null;

  // edges
  // Draw each visible edge; outgoing arrows from the selection brighten, others
  // dim, and hidden secondary dominants appear only when linked to the selection.
  edges.forEach((e,i)=>{
    if(!edgeVisible(e)) return;
    const st=EDGE_STYLE[e.t];
    let alpha=st.a, w=st.w, col=pcColor(e.a.pc,st.l), glow=0;
    const isOut=hiOut&&hiOut.has(i), isIn=hiIn&&hiIn.has(i);
    if(sel){
      if(isOut){alpha=1;w=1.8;glow=10;col=pcColor(e.a.pc,68);}
      else if(isIn){alpha=0.5;w=1.3;}
      else alpha*=0.25;
    }
    if(e.hidden&&!isOut&&!isIn) return;
    // Key focus and the note filter dim edges that fall outside them.
    if(focusSet&&!(inFocus(e.a)&&inFocus(e.b))) alpha*=0.12;
    if(noteFilter.size&&!(chordHasAll(e.a,noteFilter)&&chordHasAll(e.b,noteFilter))) alpha*=0.12;
    if(alpha<0.02) return;
    const {q,cx,cy,t0,t1}=edgePts(e);
    const [x0,y0]=q(t0),[x1,y1]=q(t1);
    ctx.globalAlpha=alpha;
    ctx.strokeStyle=col; ctx.lineWidth=w/cam.z;
    ctx.shadowBlur=glow; ctx.shadowColor=col;
    ctx.beginPath(); ctx.moveTo(x0,y0);
    ctx.quadraticCurveTo(cx,cy,x1,y1); ctx.stroke();
    // arrowhead
    // Aim the head along the curve tangent near the target rim.
    const [px,py]=q(t1-0.03);
    const an=Math.atan2(y1-py,x1-px), ah=5.5/cam.z;
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x1-ah*Math.cos(an-0.44),y1-ah*Math.sin(an-0.44));
    ctx.moveTo(x1,y1);
    ctx.lineTo(x1-ah*Math.cos(an+0.44),y1-ah*Math.sin(an+0.44));
    ctx.stroke();
    ctx.shadowBlur=0;
  });

  // comets
  // Drop expired comets, then draw each as a fading dot travelling its edge.
  comets=comets.filter(c=>now-c.t0<c.dur);
  for(const c of comets){
    const t=(now-c.t0)/c.dur;
    const {q,t0,t1}=edgePts(c.e);
    const [x,y]=q(t0+(t1-t0)*t);
    ctx.globalAlpha=1-t*0.5;
    ctx.fillStyle=pcColor(c.e.a.pc,72); ctx.shadowBlur=14; ctx.shadowColor=pcColor(c.e.a.pc,66);
    ctx.beginPath();ctx.arc(x,y,3.2/cam.z,0,TAU);ctx.fill();
    ctx.shadowBlur=0;
  }

  // nodes
  // Draw each visible chord as a labelled disc; dim by key focus, note filter,
  // and whether it links to the selection, and glow the selected or flashing one.
  for(const n of nodes){
    if(!nodeVisible(n)) continue;
    let alpha=1;
    if(focusSet&&!inFocus(n)) alpha=0.10;
    if(noteFilter.size&&!chordHasAll(n,noteFilter)) alpha=Math.min(alpha,0.10);
    if(sel&&sel!==n){
      const linked=outE[sel.id].some(e=>e.b===n&&edgeVisible(e))||inE[sel.id].some(e=>e.a===n&&edgeVisible(e));
      if(!linked) alpha=Math.min(alpha,0.30);
    }
    const col=pcColor(n.pc,64);
    const fl=flash[n.id]&&now<flash[n.id];
    ctx.globalAlpha=alpha;
    ctx.fillStyle='rgba(14,17,24,0.88)';
    ctx.strokeStyle=col; ctx.lineWidth=(sel===n?2.2:1.3)/cam.z;
    ctx.shadowBlur=(sel===n||fl)?16:0; ctx.shadowColor=col;
    ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,TAU);ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle=col;
    const fs=n.r*(n.label.length>3?0.62:0.78);
    ctx.font=fs+'px "JetBrains Mono",monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(n.label,n.x,n.y+fs*0.05);
  }
  ctx.restore();
  ctx.globalAlpha=1;
  drawRoll(now);
  }catch(err){/* one bad frame must never kill the loop */}
  requestAnimationFrame(draw);
}
// Start the animation loop.
requestAnimationFrame(draw);

/* first-touch audio unlock */
// Create the audio graph on the first pointer down anywhere, satisfying the
// browser gesture requirement before the first chord plays.
window.addEventListener('pointerdown',()=>audio(),{once:true});
