"use strict";
// ════════════════════════════════════════════════════════════════════════════
//  CHORDLAB  ·  live microphone chord detection, tuning, and notation
// ────────────────────────────────────────────────────────────────────────────
//  One mic stream feeds a single AnalyserNode. Every animation frame reads two
//  views of the same signal: the dB magnitude spectrum drives chord detection
//  and the spectrogram, the raw time-domain waveform drives the autocorrelation
//  tuner. Detection turns the spectrum into a 12-bin chroma, matches it against
//  chord templates, and smooths the scores so the named chord holds steady. The
//  UI (chroma ring, fretboard diagrams, running staff, tuner) reads that state.
//
//  AUDIO PIPELINE  (one pass per frame; entry point is "MAIN LOOP" · loop())
//  ──────────────────────────────────────────────────────────────────────────
//    mic ● getUserMedia ─▶ MediaStreamSource
//                              │
//                              ▼
//        AnalyserNode   fftSize 16384  ·  ≈2.9 Hz/bin  ·  smoothing 0.5
//                              │
//          ┌───────────────────┴────────────────────┐
//          │ getFloatFrequencyData                   │ getFloatTimeDomainData
//          ▼ freqData[]  (dB spectrum)               ▼ tdBuf[]  (waveform)
//      ┌───┴─────────────────┐                   ┌───┴──────────────┐
//      │ drawSpec()          │                   │ autoCorrelate()  │
//      │  waterfall image    │                   │  ACF2+ period    │
//      └─────────────────────┘                   │      │           │
//      ┌─────────────────────┐                   │      ▼           │
//      │ analyzeFrame()  CHORD PATH              updateTuner()       │
//      │   extractPeaks()    parabolic-interpolated spectral peaks   │
//      │   estimateTuning()  circular mean of cents deviation        │
//      │   peaksToChroma()   iterative pitch salience with harmonic  │
//      │                     SUBTRACTION ─▶ 12-bin chroma            │
//      │   cosine vs QUALS templates + bass-root bonus               │
//      │   score EMA + switch margin ─▶ curChord ─▶ setChord()       │
//      └────────────────────────────────────────────────────────────┘
//
//  RENDER TARGETS  (each is a <canvas> repainted from detection state)
//    ring   chroma wheel, chord tones lit ......... drawRing()
//    meter  oscilloscope + log band bars .......... drawMeter()
//    diag   fretboard / staff per instrument ...... redrawDiagram()
//    staff  running 4-bar notation of the log ..... drawStaff()
//    spec   rainbow waterfall + tuning ladder ..... drawSpec()
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ──────────────────────────────────────────────────────────────────────────
//    pitch classes ........ "NOTE_NAMES"       chroma wheel names + colors
//    chord templates ...... "const QUALS"      interval sets per quality
//    audio state .......... "audio state"      shared analyser + chroma buffers
//    mic start ............ "async function startMic"  getUserMedia + analyser
//    detection params ..... "const DP"         tuned thresholds and weights
//    peak picking ......... "function extractPeaks"    spectrum ─▶ peak list
//    tuning estimate ...... "function estimateTuning"  off-A440 correction
//    chroma build ......... "function peaksToChroma"   salience + subtraction
//    decision ............. "function analyzeFrame"    templates ─▶ curChord
//    dominant chord ....... "function renderDominant"  passage-level winner
//    set chord ............ "function setChord"        commit + log + diagram
//    session tally ........ "function bumpTally"       per-span histogram
//    chroma ring .......... "function drawRing"        the wheel canvas
//    guitar library ....... "OPEN_SHAPES"      open + movable voicings
//    ukulele search ....... "function ukeVoicings"     exhaustive first-position
//    bass map ............. "function drawBass"        chord-tone fretboard
//    chord box ............ "function drawChordBox"    guitar/uke diagram
//    violin map ........... "function drawViolin"      first-position tones
//    input meter .......... "function drawMeter"       scope + bands
//    staff ................ "function drawStaff"       running notation
//    tuner ................ "autoCorrelate"    ACF2+ pitch detector
//    spectrogram .......... "function drawSpec"        waterfall + ladder
//    strum synth .......... "function strum"           audible chord preview
//    main loop ............ "function loop"    per-frame scheduler
//    mobile tabs .......... "function setMTab" narrow-screen column switch
// ════════════════════════════════════════════════════════════════════════════
/* ════════════════════════════════════════════════════════════
   ChordLab — live chord detection
   mic → FFT → peak picking → pitch salience → chord
   GREP: analyzeFrame | extractPeaks | drawRing | drawGuitar |
         drawViolin | drawStaff | strum
   ════════════════════════════════════════════════════════════ */

/* ── pitch classes & colors: the chroma wheel ── */
// The 12 pitch classes indexed 0=C..11=B. Every chord tone, chroma bin, and
// canvas color keys off this index, so one pitch class always paints one hue.
const NOTE_NAMES=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const FLAT_NAMES=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
// Map a pitch class to a hue: 30 degrees per semitone wraps the octave to a
// full color wheel. l is lightness percent, a is alpha for the transparent form.
const pcColor=(pc,l=64)=>`hsl(${pc*30},88%,${l}%)`;
const pcColorA=(pc,a,l=64)=>`hsla(${pc*30},88%,${l}%,${a})`;

/* ── chord templates ── */
// Each chord quality is a set of semitone intervals above the root (iv) plus a
// spelled-out name. These interval sets seed both the detection templates and
// the diagram/strum chord-tone sets, so detection and display never disagree.
const QUALS={
  ''    :{iv:[0,4,7],       full:'major'},
  'm'   :{iv:[0,3,7],       full:'minor'},
  '7'   :{iv:[0,4,7,10],    full:'dominant 7'},
  'maj7':{iv:[0,4,7,11],    full:'major 7'},
  'm7'  :{iv:[0,3,7,10],    full:'minor 7'},
  'sus2':{iv:[0,2,7],       full:'suspended 2'},
  'sus4':{iv:[0,5,7],       full:'suspended 4'},
  'dim' :{iv:[0,3,6],       full:'diminished'},
};
const QUAL_KEYS=Object.keys(QUALS);

/* ── audio state ── */
// AC is the AudioContext, analyser the single AnalyserNode both paths read.
// freqData holds the current dB spectrum; binHz is the width of one FFT bin.
let AC=null, analyser=null, micOn=false;
let freqData=null, binHz=0;
const chroma=new Float32Array(12);      // smoothed, normalized 0..1 (drives the ring)
let level=0;                             // overall input level 0..1
let curChord=null;                       // {root,q,score} confirmed
let lastLogT=0;

/* ── detected-chord log for the staff ── */
// Ordered history of committed chords, capped so the staff stays bounded.
const chordLog=[];   // {root, q}
const MAX_LOG=64;

/* ═══════════ MIC ═══════════ */
// Short id lookup used everywhere below.
const $=id=>document.getElementById(id);
// Open the mic and wire the analyser. getUserMedia disables echo cancel and
// noise suppression (they eat harmonic content) but keeps auto gain so quiet
// and loud instruments both reach a usable level.
async function startMic(){
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:true}});
    const src=AC.createMediaStreamSource(stream);
    analyser=AC.createAnalyser();
    analyser.fftSize=16384;              // 2.9 Hz/bin — resolves semitones at low E
    analyser.smoothingTimeConstant=0.5;
    src.connect(analyser);
    // Allocate the spectrum buffer and record bin width so every consumer maps
    // frequency to bin index the same way.
    freqData=new Float32Array(analyser.frequencyBinCount);
    binHz=AC.sampleRate/analyser.fftSize;
    micOn=true;
    $('micGate').classList.add('hidden');
    $('st-mic').innerHTML='mic <b>live</b>';
  }catch(e){
    const el=$('micErr');
    el.style.display='block';
    el.textContent='Microphone unavailable — check browser permissions and try again. ('+(e.name||e.message)+')';
  }
}
// The Start Listening button is the required user gesture that unlocks audio.
$('micBtn').addEventListener('click',startMic);

/* ════════════════════════════════════════════════════════════
   DETECTION CORE — benchmarked offline against 585 synthesized
   guitar-voicing cases + a stress set (detuned, bright, noisy,
   dropped strings). Old pipeline: 92% exact / 82% stressed.
   This pipeline: 99% exact / 91% stressed, 97% root.
   Stages:
     1. spectral peak picking + quadratic interpolation
     2. circular-mean tuning estimation (compensates off-A440)
     3. iterative pitch salience with harmonic SUBTRACTION —
        each found note's overtone series is removed from the
        peak list, so E's 3rd harmonic can't masquerade as B
     4. near-binary chord templates, cosine + bass-root bonus
     5. score-domain EMA smoothing with a switch margin
   GREP: extractPeaks | peaksToChroma | analyzeFrame
   ════════════════════════════════════════════════════════════ */
// Detection tuning constants, grouped by pipeline stage. Values were fixed by
// the offline benchmark above; each is named so a stage can be retuned in place.
//   FMIN/FMAX ...... analysis band in Hz
//   PEAK_* ......... peak floor: absolute dB and dB above local median
//   MAX_PEAKS ...... keep only the loudest N peaks
//   SAL_NH ......... harmonics summed when scoring a candidate pitch
//   SAL_DECAY ...... per-harmonic weight falloff
//   SUB_STRENGTH ... fraction of a found note's harmonics subtracted out
//   MAX_NOTES ...... max simultaneous pitches extracted
//   SAL_STOP ....... stop when salience drops below this share of the first
//   MIDI_LO/HI ..... pitch search range in MIDI numbers
//   TOL ............ half-window in semitones for matching a peak to a target
//   TMPL_* ......... template harmonic residual depth and decay
//   ROOT_W ......... extra template weight on the root pitch class
//   BASS_BONUS ..... reward a template whose root is in the bass register
//   CPOW ........... chroma compression exponent (tames dominant peaks)
//   SM_ALPHA ....... per-frame EMA rate on template scores
//   SWITCH_MARGIN .. how far a rival must beat the incumbent to take over
//   SCORE_FLOOR .... reject a best match weaker than this
const DP={
  FMIN:62,FMAX:2500,PEAK_FLOOR_DB:-78,PEAK_ABOVE_MED:10,MAX_PEAKS:34,
  SAL_NH:6,SAL_DECAY:0.75,SUB_STRENGTH:0.92,MAX_NOTES:8,SAL_STOP:0.16,
  MIDI_LO:36,MIDI_HI:79,TOL:0.35,BASS_MIDI:55,
  TMPL_NH:2,TMPL_DECAY:0.10,ROOT_W:1.15,BASS_BONUS:0.085,CPOW:0.7,
  SM_ALPHA:0.38,SWITCH_MARGIN:0.02,SCORE_FLOOR:0.55,
};
// Harmonic series offsets from a fundamental. HARM_ST is in exact semitones
// (fractional: the 3rd harmonic is 19.02 st, not 19), used to place salience
// probes on the true overtone frequencies. HARM_PC is the same rounded to
// pitch classes, used when folding template harmonics into 12 bins.
const HARM_ST=[0,12,19.02,24,27.86,31.02];
const HARM_PC=[0,12,19,24,28];

/* templates: near-binary + light harmonic residual, unit-normalized */
// Precompute one 12-bin reference vector per (root, quality). Each chord tone
// gets weight 1 (root gets ROOT_W), plus a faint TMPL_DECAY-scaled echo on its
// first overtones so the template resembles the chroma a real instrument makes.
// Unit-normalizing every vector turns the later dot product into a cosine.
const detTemplates=[];
const tmplIdx={};
for(const q of QUAL_KEYS){
  for(let root=0;root<12;root++){
    const v=new Float32Array(12);
    // Deposit each interval, weighting the root and adding TMPL_NH harmonics.
    QUALS[q].iv.forEach((iv,idx)=>{
      const nw=idx===0?DP.ROOT_W:1.0;
      for(let h=0;h<DP.TMPL_NH;h++)v[(root+iv+HARM_PC[h])%12]+=nw*Math.pow(DP.TMPL_DECAY,h);
    });
    // L2-normalize so template magnitude never biases the cosine score.
    let n=0;for(let i=0;i<12;i++)n+=v[i]*v[i];n=Math.sqrt(n);
    for(let i=0;i<12;i++)v[i]/=n;
    // Remember each template's array position by "root|quality" for fast lookup.
    tmplIdx[root+'|'+q]=detTemplates.length;
    detTemplates.push({root,q,v});
  }
}
// detScores: raw per-frame cosine. smScores: EMA-smoothed scores that decide.
const detScores=new Float32Array(detTemplates.length);
const smScores=new Float32Array(detTemplates.length);
// Scratch buffers reused every frame to avoid per-frame allocation.
const detPeaks=[];
const bassChroma=new Float32Array(12);
const rawChroma=new Float32Array(12);
// tuningCents: running off-A440 estimate. noteCount/quietTicks: frame counters.
let tuningCents=0,noteCount=0,quietTicks=0;

// STAGE 1 — spectral peak picking. Walk the analysis band, keep local maxima
// above an adaptive floor, and refine each to sub-bin frequency with a parabola.
function extractPeaks(){
  // Convert the Hz band to bin indices, staying one bin inside each edge so the
  // three-point parabola never reads out of bounds.
  const i0=Math.max(2,Math.floor(DP.FMIN/binHz));
  const i1=Math.min(freqData.length-2,Math.ceil(DP.FMAX/binHz));
  // Coarse median (every 4th bin) estimates the noise floor of this frame.
  let med=0,cnt=0;
  for(let i=i0;i<=i1;i+=4){med+=freqData[i];cnt++;}
  med=cnt?med/cnt:-100;
  // A peak must clear both the absolute floor and the local median by a margin.
  const floor=Math.max(DP.PEAK_FLOOR_DB,med+DP.PEAK_ABOVE_MED);
  detPeaks.length=0;
  let energy=0;
  for(let i=i0;i<=i1;i++){
    const y=freqData[i];
    if(y<floor)continue;
    // Keep only strict local maxima (higher than both neighbours).
    if(y<=freqData[i-1]||y<freqData[i+1])continue;
    // Parabolic interpolation over the three dB samples gives the true peak
    // offset (off) and amplitude between bins — sub-bin frequency accuracy.
    const a=freqData[i-1],b=y,c=freqData[i+1];
    const den=a-2*b+c;
    const off=den!==0?0.5*(a-c)/den:0;
    const f=(i+off)*binHz;
    // Interpolated dB back to linear magnitude; also store MIDI number for later.
    const m=Math.pow(10,(b-0.25*(a-c)*off)/20);
    detPeaks.push({f,m,midi:69+12*Math.log2(f/440)});
    energy+=m;
  }
  // Cap the peak list to the loudest MAX_PEAKS so salience search stays cheap.
  if(detPeaks.length>DP.MAX_PEAKS){
    detPeaks.sort((x,y)=>y.m-x.m);
    detPeaks.length=DP.MAX_PEAKS;
  }
  // Summed peak magnitude is the input level gate the rest of the loop reads.
  level=Math.min(1,energy*9);
}
// STAGE 2 — tuning estimate. Each peak's deviation from its nearest semitone is
// an angle on a circle; the magnitude-weighted circular mean gives how far the
// whole instrument sits off A440, in cents. Circular averaging handles the wrap
// at ±50 cents that a plain average would smear.
function estimateTuning(){
  let sx=0,sy=0;
  for(const p of detPeaks){
    // Deviation in fractional semitones ─▶ angle; weight by amplitude root.
    const dev=p.midi-Math.round(p.midi);
    const ang=dev*2*Math.PI,w=Math.sqrt(p.m);
    sx+=Math.cos(ang)*w;sy+=Math.sin(ang)*w;
  }
  // No peaks: hold the last estimate. Otherwise mean angle back to cents.
  if(sx===0&&sy===0)return tuningCents;
  return Math.atan2(sy,sx)/(2*Math.PI)*100;
}
// STAGE 3 — iterative pitch salience with harmonic subtraction. Repeatedly find
// the MIDI pitch whose harmonic comb collects the most peak energy, record it,
// then remove that comb from the peaks so its overtones cannot be mistaken for
// separate notes. This is what stops E's 3rd harmonic from reading as a B.
function peaksToChroma(){
  rawChroma.fill(0);bassChroma.fill(0);noteCount=0;
  const nP=detPeaks.length;if(!nP)return;
  // Shift every peak by the tuning estimate so probes align to true semitones.
  const tune=tuningCents/100;
  // Working copies: mags is mutated by subtraction; midis is tuning-corrected.
  const mags=detPeaks.map(p=>p.m);
  const midis=detPeaks.map(p=>p.midi-tune);
  // Find the strongest remaining peak within TOL semitones of a target pitch.
  function magNear(target){
    let best=-1,bm=0;
    for(let i=0;i<nP;i++){
      if(mags[i]<=0)continue;
      const d=Math.abs(midis[i]-target);
      if(d<DP.TOL&&mags[i]>bm){bm=mags[i];best=i;}
    }
    return{i:best,m:bm};
  }
  // Salience of a candidate fundamental: decay-weighted sum of the magnitudes
  // found at each of its harmonics. A real note lights its whole comb.
  function salience(m0){
    let s=0;
    for(let h=0;h<DP.SAL_NH;h++){
      const r=magNear(m0+HARM_ST[h]);
      if(r.i>=0)s+=r.m*Math.pow(DP.SAL_DECAY,h);
    }
    return s;
  }
  let firstSal=0;
  // Extract up to MAX_NOTES pitches, strongest first.
  for(let it=0;it<DP.MAX_NOTES;it++){
    // Scan the MIDI range for the most salient fundamental this round.
    let bestM=-1,bestS=0;
    for(let m0=DP.MIDI_LO;m0<=DP.MIDI_HI;m0++){
      const s=salience(m0);
      if(s>bestS){bestS=s;bestM=m0;}
    }
    if(bestM<0)break;
    // Remember the first (loudest) salience; stop once notes fade below its share.
    if(it===0)firstSal=bestS;
    else if(bestS<firstSal*DP.SAL_STOP)break;
    // Bank this pitch's energy into its chroma bin (and the bass bin if low).
    const pc=((bestM%12)+12)%12;
    rawChroma[pc]+=bestS;
    if(bestM<DP.BASS_MIDI)bassChroma[pc]+=bestS;
    noteCount++;
    // SUBTRACTION: scale the found note's whole comb out of the peak list so the
    // next round sees only energy this note did not explain.
    const f1=magNear(bestM);
    const A=f1.i>=0?f1.m:bestS*0.5;
    for(let h=0;h<DP.SAL_NH;h++){
      const r=magNear(bestM+HARM_ST[h]);
      if(r.i>=0)mags[r.i]=Math.max(0,mags[r.i]-A*Math.pow(DP.SAL_DECAY,h)*DP.SUB_STRENGTH);
    }
  }
  // Compress with CPOW so a few loud tones do not swamp softer chord tones,
  // then normalize the chroma to a 0..1 profile.
  let mx=0;
  for(let i=0;i<12;i++){rawChroma[i]=Math.pow(rawChroma[i],DP.CPOW);if(rawChroma[i]>mx)mx=rawChroma[i];}
  if(mx>0)for(let i=0;i<12;i++)rawChroma[i]/=mx;
  // Normalize the bass chroma separately; it feeds only the bass-root bonus.
  let bmx=0;
  for(let i=0;i<12;i++)if(bassChroma[i]>bmx)bmx=bassChroma[i];
  if(bmx>0)for(let i=0;i<12;i++)bassChroma[i]/=bmx;
}

/* ═══════════ DECISION — smoothed scores + switch margin ═══════════ */
// Minimum level below which a frame counts as silence.
const GATE=0.045;
// STAGE 4/5 — run the pipeline, score templates, and commit a smoothed chord.
// Called at ~16 Hz from the main loop (every 0.06 s), not every render frame.
function analyzeFrame(){
  extractPeaks();
  // Silence: bleed smoothed scores toward zero and drop the chord after a beat.
  if(level<GATE||!detPeaks.length){
    quietTicks++;
    for(let i=0;i<smScores.length;i++)smScores[i]*=0.8;
    for(const k in domScores)domScores[k]*=0.992;
    if(quietTicks>4&&curChord)setChord(null);
    return;
  }
  quietTicks=0;
  for(const k in domScores)domScores[k]*=0.988;   // ~4 s memory at 16 Hz
  tuningCents+= (estimateTuning()-tuningCents)*0.15;   // slow EMA — a guitar's tuning doesn't jump
  peaksToChroma();
  // display chroma follows the cleaned profile
  for(let i=0;i<12;i++)chroma[i]+=(rawChroma[i]-chroma[i])*0.4;
  // cosine vs templates + bass bonus
  // n normalizes rawChroma so the dot product below is a true cosine similarity.
  let n=0;for(let i=0;i<12;i++)n+=rawChroma[i]*rawChroma[i];
  if(n<1e-9)return;
  n=Math.sqrt(n);
  // Score every template, add the bass-root bonus, and EMA-smooth each score.
  for(let t=0;t<detTemplates.length;t++){
    const tm=detTemplates[t];
    let s=0;for(let i=0;i<12;i++)s+=(rawChroma[i]/n)*tm.v[i];
    s+=DP.BASS_BONUS*bassChroma[tm.root];
    detScores[t]=s;
    smScores[t]+=(s-smScores[t])*DP.SM_ALPHA;
  }
  // single note: only one pitch class alive
  // Count chroma bins above 0.3; one lone bin plus one extracted note means the
  // player sounded a single note, so report it as a note, not a chord.
  let live=0,domPc=0;
  for(let i=0;i<12;i++)if(rawChroma[i]>0.3){live++;domPc=i;}
  if(noteCount<=1&&live<=1){
    setChord({root:domPc,q:'·note',score:rawChroma[domPc]});
    return;
  }
  // best smoothed chord
  // Pick the top smoothed template; reject it if even the best is too weak.
  let bestI=0;
  for(let t=1;t<smScores.length;t++)if(smScores[t]>smScores[bestI])bestI=t;
  const bestS=smScores[bestI],bt=detTemplates[bestI];
  if(bestS<DP.SCORE_FLOOR)return;
  // Hysteresis: the incumbent chord holds unless a rival beats it by the switch
  // margin. This stops flicker between near-tied qualities of the same root.
  const curI=curChord&&curChord.q!=='·note'?tmplIdx[curChord.root+'|'+curChord.q]:-1;
  if(curI<0||bestI===curI||bestS>smScores[curI]+DP.SWITCH_MARGIN){
    if(!curChord||curChord.root!==bt.root||curChord.q!==bt.q)
      setChord({root:bt.root,q:bt.q,score:bestS});
    else curChord.score=bestS;
  }else{
    curChord.score=smScores[curI];
  }
  // Feed the passage-level vote so the dominant banner can name the winner.
  if(curChord&&curChord.q!=='·note')
    domScores[curChord.root+'|'+curChord.q]=(domScores[curChord.root+'|'+curChord.q]||0)+1;
}

/* ═══════════ DOMINANT CHORD — the passage-level winner ═══════════
   Instant detection flickers between near-ties; this is a decaying
   vote with switch hysteresis, so the banner names the chord that is
   actually carrying the passage. */
// domScores: decaying vote per "root|quality". domKey: the current leader.
const domScores=Object.create(null);
let domKey=null;
// Paint the Likely Chords banner: rank the votes, hold the leader unless clearly
// beaten, and size each pill by its share of the winner.
function renderDominant(){
  const el=$('domList');
  let entries=Object.entries(domScores).sort((a,b)=>b[1]-a[1]);
  const bv=entries.length?entries[0][1]:0;
  if(bv<6){                                   // not enough evidence yet
    domKey=null;
    el.innerHTML='<span class="domEmpty">listening for a passage…</span>';
    return;
  }
  // leader hysteresis: the incumbent holds slot 1 unless clearly beaten
  let bk=entries[0][0];
  if(domKey&&bk!==domKey&&bv<=(domScores[domKey]||0)*1.3)bk=domKey;
  domKey=bk;
  // Keep the top few chords worth showing, then force the leader into slot 1.
  entries=entries.filter(([k,v])=>v>bv*0.12).slice(0,5);
  entries.sort((a,b)=>(a[0]===bk?-1:b[0]===bk?1:b[1]-a[1]));
  const max=domScores[bk]||bv;
  el.innerHTML=entries.map(([k,v],i)=>{
    const[r,q]=k.split('|');
    const sh=Math.min(1,v/max);
    const fs=(i===0?2.35:0.95+1.05*sh).toFixed(2);
    const glow=i===0?0.5:0.22*sh;
    return `<div class="domPill">
      <span class="dp-name" style="font-size:${fs}rem;color:${pcColor(+r,i===0?68:56)};text-shadow:0 0 ${i===0?24:10}px ${pcColorA(+r,glow)}">${NOTE_NAMES[+r]}${q}</span>
      <span class="dp-bar"><i style="width:${Math.round(sh*100)}%;background:${pcColorA(+r,0.8)}"></i></span>
    </div>`;
  }).join('');
}
// Commit a detected chord: update the center readout, log real chords to the
// staff and tally, and drive the fretboard diagram. A null argument clears it.
function setChord(c){
  curChord=c;
  const rEl=$('chordRoot'),qEl=$('chordQual'),cEl=$('chordConf');
  if(!c){
    rEl.textContent='···';rEl.style.color='var(--text-faint)';rEl.style.textShadow='none';
    qEl.textContent='listening';qEl.style.color='var(--text-faint)';
    cEl.textContent='— %';
    $('st-chord').textContent='chord —';
    return;
  }
  const isNote=c.q==='·note';
  rEl.textContent=NOTE_NAMES[c.root];
  rEl.style.color=pcColor(c.root,68);
  rEl.style.textShadow=`0 0 44px ${pcColorA(c.root,0.55)}`;
  qEl.textContent=isNote?'single note':(QUALS[c.q]?QUALS[c.q].full:c.q);
  qEl.style.color=pcColor(c.root,52);
  $('st-chord').innerHTML='chord <b>'+NOTE_NAMES[c.root]+c.q.replace('·note','')+'</b>';
  // log real chords to the staff (rate-limited)
  // Rate-limit to one entry per 380 ms so a held chord logs once, not per frame.
  const now=performance.now();
  if(!isNote && now-lastLogT>380){
    lastLogT=now;
    chordLog.push({root:c.root,q:c.q});
    if(chordLog.length>MAX_LOG)chordLog.shift();
    $('st-log').textContent=chordLog.length+' logged';
    staffDirty=true;
    bumpTally(c.root,c.q);
    setDiagramChord(c.root,c.q);
  } else if(isNote){
    setDiagramChord(c.root,'');
  }
}

/* ═══════════ SESSION TALLY — which chords live in this span ═══════════ */
// Per-span histogram: how many times each chord has been committed since clear.
const tally=Object.create(null);
// Increment one chord's count and repaint the Most Detected list.
function bumpTally(root,q){
  const k=root+'|'+q;
  tally[k]=(tally[k]||0)+1;
  renderTally();
}
// Render the top six tallied chords as labeled proportional bars.
function renderTally(){
  const el=$('tally');
  const entries=Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(!entries.length){
    el.innerHTML='<div id="tallyEmpty">play something — chords tally up here…</div>';
    return;
  }
  const max=entries[0][1];
  el.innerHTML=entries.map(([k,n])=>{
    const[r,q]=k.split('|');
    return `<div class="cand">
      <span class="cname" style="color:${pcColor(+r,66)}">${NOTE_NAMES[+r]}${q}</span>
      <span class="cbar"><span class="cfill" style="width:${Math.round(n/max*100)}%;background:${pcColorA(+r,0.8)}"></span></span>
      <span class="cpct" style="color:${pcColor(+r,60)}">×${n}</span></div>`;
  }).join('');
}

