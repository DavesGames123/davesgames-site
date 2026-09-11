// ============================================================================
//  HOHMANN TRANSFER CALCULATOR  ·  canvas-2D orbital-transfer sandbox
// ----------------------------------------------------------------------------
//  Pick a source planet and a target planet in a top-down solar system; the
//  page computes the minimum-energy Hohmann transfer between their two circular
//  coplanar orbits, draws the transfer ellipse and the burn markers, and shows
//  the next launch windows. Pressing Launch flies a ship along the ellipse and
//  grades how close the launch was to the ideal phasing.
//
//  MODEL (analytic, not force-integrated)
//  --------------------------------------
//  Every orbit is a circle of radius r about the Sun, so a planet's angle is a
//  closed form of time: ang = angle0 + omega·t, omega = sqrt(MU/r^3) = TAU/T.
//  The ship rides the transfer ellipse; its position comes from solving Kepler's
//  equation each frame, never from stepping forces. Units are AU and years, so
//  MU = 4·pi^2 makes a circular orbit of r = 1 AU have period T = 1 yr.
//
//  ORBIT GEOMETRY  (Hohmann transfer, ascending case r2 > r1)
//  ----------------------------------------------------------
//                         outer circular orbit  r2
//                    ● ─────────────────────────────── ●
//                 ╱                                        ╲
//               ╱          transfer ellipse                 ╲
//              │      apoapsis ●═══════════════●─── Δv2 (circularise)
//              │     (r=rApo) ╱                 ╲
//              │            ╱   Sun ●            │   ● inner orbit r1
//              │           │    (focus)          │  ╱
//               ╲          ●───────────────●────●  Δv1 (inject onto ellipse)
//                 ╲       periapsis (r=rPer)     ╱
//                    ● ──────── inner circular orbit r1
//        a_t = (r1+r2)/2   ·  the ellipse is tangent to both circles, one burn
//        at each tangent point; that tangency is what makes it minimum-Δv.
//
//  SCREEN FRAME  (canvas y grows downward, math y grows upward)
//  -----------------------------------------------------------
//        world (x right, y up)  ──▶  screen: sx = CX + x·SCALE
//                                             sy = CY − y·SCALE   (y flips)
//        Sun sits at (CX,CY); SCALE fits the widest orbit to 42% of the view.
//
//  FRAME LOOP  (frame(), one requestAnimationFrame tick)
//  -----------------------------------------------------
//        advance simTime ─▶ move ship (Kepler solve or park on target orbit)
//              │                        └─ recompute launch windows if idle
//              ▼
//        drawBg ─▶ orbits ─▶ windows ─▶ ellipse geometry ─▶ ellipse+burns
//              ─▶ planets+labels ─▶ ship ─▶ burn vector ─▶ score ─▶ guidance
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      constants ............ "PHYSICS CONSTANTS"     MU, unit conversions, state
//      canvas + resize ...... "CANVAS"                sizing and world→screen SCALE
//      system presets ....... "PLANET GENERATION"     genSystem and the 5 presets
//      preset loader ........ "function loadPreset"   swap systems, reset selection
//      orbital math ......... "PHYSICS"               vis-viva, Kepler, computeXfer
//      launch windows ....... "function computeWindows"  phase-angle rendezvous
//      launch grading ....... "const GRADES"          A+ .. F by day error
//      drawing ............. "DRAWING"               stars, planets, ship, HUD
//      ellipse render ....... "function drawXferEllipse"  the dashed transfer path
//      ellipse geometry ..... "function drawEllipseGeometry"  a,b,c,r1,r2 labels
//      ship update .......... "function updateShip"   Kepler solve along ellipse
//      main loop ............ "MAIN LOOP"             per-frame update and draw
//      input ................ "INPUT"                 pick planets, keys, touch
//      launch/hop/clear ..... "function launch"       the action-bar buttons
//      math panel ........... "MATH PANEL RENDERING"  live KaTeX walkthrough
//      init ................. "/* INIT */"            first preset + start loop
// ============================================================================

/* ═════════════════════════════════════════════════════════════
   PHYSICS CONSTANTS
   ═════════════════════════════════════════════════════════════ */
// Gravitational parameter in AU/year units: with MU = 4·pi^2 a circular orbit
// at r = 1 AU has period 1 yr (Kepler's third law, T^2 = 4·pi^2·a^3/MU).
// AU_KM and YR_S convert the internal AU/yr speeds to km/s for display.
const MU=4*Math.PI*Math.PI, AU_KM=1.496e8, YR_S=3.156e7;
// AU2KMS turns one AU/yr into km/s; TAU is a full turn in radians.
const AU2KMS=AU_KM/YR_S, TAU=Math.PI*2;
// Cap device-pixel-ratio at 2 so retina screens do not blow up the backing store.
const DPR=Math.min(devicePixelRatio||1,2);
const BASE_TS=0.035; // years per real-second at 1× speed

// Live simulation state. planets is the current system; source/target are the
// picked orbits; xfer is the computed transfer; ship is the flying spacecraft.
let planets=[], source=null, target=null, xfer=null, ship=null;
// simTime is elapsed sim years; lastT is the previous frame timestamp.
let hovered=null, simTime=0, lastT=null, paused=false;
// launchWindows are the upcoming optimal departure times; launchScore is the grade.
let launchWindows=[], launchScore=null;
// Hop mode chains transfers: the ship parks at each arrival and hops onward.
let hopMode=false, hopLog=[], hopHomePlanet=null;
let currentPreset='random';

/* ═════════════════════════════════════════════════════════════
   CANVAS
   ═════════════════════════════════════════════════════════════ */
const cvs=document.getElementById('cvs'), ctx=cvs.getContext('2d');
const wrap=document.getElementById('canvasArea');
// W,H are CSS pixels; CX,CY are the Sun (view centre); SCALE is AU→pixels.
let W,H,CX,CY,SCALE;

// Match the backing store to the container and DPR, then pick SCALE so the
// widest orbit fills 42% of the shorter view dimension.
function resize(){
  const r=wrap.getBoundingClientRect();
  W=r.width; H=r.height;
  cvs.width=W*DPR; cvs.height=H*DPR;
  cvs.style.width=W+'px'; cvs.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  CX=W/2; CY=H/2;
  const maxR=planets.length?Math.max(...planets.map(p=>p.r)):4;
  SCALE=(Math.min(W,H)*0.42)/maxR;
}
// Re-fit on resize and drop the cached starfield so it regenerates for new W,H.
window.addEventListener('resize',()=>{resize();_sc=null});

/* ═════════════════════════════════════════════════════════════
   PLANET GENERATION — parameterised system presets
   ═════════════════════════════════════════════════════════════ */
// Pool of invented planet names; each system draws a shuffled subset.
const NAMES=['Auvon','Belrix','Cytha','Dural','Exven','Farux','Glyth','Helox',
             'Iyral','Juvex','Kelon','Lythos','Myrvax','Nexul','Ophryn','Pyreth'];

// Build a system from period ratios. Each planet's period T grows by a ratio
// per step; its radius follows Kepler's third law, r = T^(2/3). Hues are spread
// so neighbouring planets stay visually distinct. opts: {startT, count, maxR,
// ratios[], jitter, size}.
function genSystem(opts){
  const names=[...NAMES].sort(()=>Math.random()-0.5);
  const hues=[];
  planets=[];
  let T=opts.startT;
  for(let i=0;i<opts.count;i++){
    // Semi-major radius from period by Kepler's third law (r^3 = T^2 here).
    const r=Math.pow(T,2/3);
    // Stop once the orbit would exceed the preset's outer bound.
    if(r>opts.maxR) break;
    // Reject a hue within 36 degrees of an existing one (up to 30 tries).
    let hue,att=0;
    do{hue=Math.random()*360;att++}
    while(att<30&&hues.some(h=>Math.min(Math.abs(h-hue),360-Math.abs(h-hue))<36));
    hues.push(hue);
    // omega is angular rate (TAU/T); speed is circular orbital speed sqrt(MU/r).
    planets.push({
      name:names[i], r, period:T,
      omega:TAU/T, speed:Math.sqrt(MU/r),
      angle:Math.random()*TAU,
      hue, size:opts.size||(3+Math.random()*4),
      color:`hsl(${hue},65%,62%)`
    });
    // Step the period by the next ratio, with optional random jitter.
    const ratio=opts.ratios[i%opts.ratios.length];
    const jit=opts.jitter||0;
    T*=ratio*(1+jit*(Math.random()*2-1));
  }
}

// Random: 5 to 7 planets with mixed, slightly jittered period ratios.
function genRandom(){
  genSystem({
    startT:0.15+Math.random()*0.12,
    count:5+Math.floor(Math.random()*3),
    maxR:5,
    ratios:[2,1.5,2,1.5,4/3,1.5],
    jitter:0.03
  });
}
// Inner: a tight 4-planet system inside 1.4 AU.
function genInner(){
  genSystem({
    startT:0.08,
    count:4,
    maxR:1.4,
    ratios:[1.5,4/3,1.5],
    jitter:0.02
  });
}
// Outer: 3 widely spaced giants out to 8 AU.
function genOuter(){
  genSystem({
    startT:0.8,
    count:3,
    maxR:8,
    ratios:[2.2,2.5],
    jitter:0.02
  });
}
// Laplace: exact 2:1 period chain (1:2:4:8), the classic resonance demo.
function genLaplace(){
  // 1:2:4:8 period ratios → exact 2:1 chain (the most pedagogical resonance)
  genSystem({
    startT:0.18,
    count:4,
    maxR:5,
    ratios:[2,2,2],
    jitter:0,
    size:4
  });
}
// Binary: two close planets for the simplest possible transfer.
function genBinary(){
  genSystem({
    startT:0.6,
    count:2,
    maxR:3,
    ratios:[1.35],
    jitter:0,
    size:5
  });
}

// Swap in a named system and reset every selection, ship, and HUD element so
// the page returns to the "pick a planet" idle state.
function loadPreset(name,btn){
  currentPreset=name;
  // Highlight the matching preset card in the action bar.
  document.querySelectorAll('.pcard').forEach(c=>c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  else{
    const c=document.querySelector(`.pcard[data-preset="${name}"]`);
    if(c) c.classList.add('active');
  }
  // Generate the chosen system's planets.
  if(name==='random') genRandom();
  else if(name==='inner') genInner();
  else if(name==='outer') genOuter();
  else if(name==='laplace') genLaplace();
  else if(name==='binary') genBinary();

  // Clear all selection, transfer, ship, and hop state for the new system.
  source=target=xfer=ship=null;
  launchWindows=[]; launchScore=null;
  hopLog=[]; hopHomePlanet=null; hopMode=false;
  // Reset the Hop button label and reset the clock.
  const hb=document.getElementById('btnHop');
  hb.classList.remove('active'); hb.innerHTML='&#11041; Hop';
  simTime=0; lastT=null;
  // Re-fit the view to the new orbits and reset the HUD to idle.
  resize();
  setBtnLaunch(false); setTbar(false);
  setEqPanelActive(false);
  setStatus('AWAITING SELECTION');
  renderMath();
  // On narrow screens, hide the math drawer so the canvas is unobstructed.
  if(window.innerWidth<=980) closeMathDrawer();
}

/* ═════════════════════════════════════════════════════════════
   PHYSICS
   ═════════════════════════════════════════════════════════════ */
// Circular orbital speed at radius r: v = sqrt(MU/r).
const vCirc=(r)=>Math.sqrt(MU/r);
// Vis-viva speed at radius r on a conic of semi-major axis a: v = sqrt(MU(2/r - 1/a)).
const visViva=(r,a)=>Math.sqrt(MU*(2/r-1/a));

// Solve Kepler's equation M = E - e·sin(E) for eccentric anomaly E by
// Newton-Raphson. Converges fast for the small e of a Hohmann ellipse.
function solveKepler(M,e){
  let E=M;
  for(let i=0;i<60;i++){
    const d=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
    E-=d; if(Math.abs(d)<1e-12) break;
  }
  return E;
}
// Compute the full Hohmann transfer between circular orbits r1 and r2. Returns
// the ellipse geometry (a_t,b_t,c_t,e_t), circular and transfer speeds, both
// burn magnitudes, and the half-period transfer time. asc marks r2 >= r1.
function computeXfer(r1,r2){
  // Periapsis is the smaller circle, apoapsis the larger; the ellipse is
  // tangent to both, so its major axis spans rPer to rApo.
  const asc=r2>=r1, rPer=Math.min(r1,r2), rApo=Math.max(r1,r2);
  // Semi-major axis a_t = (rPer+rApo)/2; focus offset c_t = a_t - rPer.
  const a_t=(rPer+rApo)/2, c_t=a_t-rPer;
  // Semi-minor axis from b^2 = a^2 - c^2; eccentricity e = c/a.
  const b_t=Math.sqrt(Math.max(0,a_t*a_t-c_t*c_t)), e_t=c_t/a_t;
  // Circular speeds on each orbit and transfer-ellipse speeds at each tangent.
  const vc1=vCirc(r1), vc2=vCirc(r2);
  const v1=visViva(r1,a_t), v2=visViva(r2,a_t);
  // Burn magnitudes are the speed jumps between circular and transfer speeds.
  const dv1=Math.abs(v1-vc1), dv2=Math.abs(v2-vc2);
  // Transfer time is half the ellipse period: t = pi·sqrt(a^3/MU).
  const tTr=Math.PI*Math.sqrt(Math.pow(a_t,3)/MU);
  return{r1,r2,rPer,rApo,a_t,b_t,c_t,e_t,asc,vc1,vc2,v1,v2,dv1,dv2,dvTot:dv1+dv2,tTr};
}

/* Launch windows: target lead angle at launch = π − ω_tgt · t_tr */
// Find the next `count` departure times. The target must lead the ship by
// phi_req at launch so it arrives at apoapsis exactly when the ship does. The
// relative phase drifts at rate dphi = omega_tgt - omega_src, so each window is
// where phi_now reaches phi_req (mod TAU). k enumerates successive turns.
function computeWindows(src,tgt,tr,now,count=3){
  // Required target lead so it reaches the rendezvous point after t_tr.
  const phi_req=Math.PI-tgt.omega*tr.tTr;
  // Current angles of both bodies at time `now`.
  const theta_src=src.angle+src.omega*now;
  const theta_tgt=tgt.angle+tgt.omega*now;
  // Present lead of target over source, and its drift rate.
  const phi_now=theta_tgt-theta_src;
  const dphi=tgt.omega-src.omega;
  // Two equal-period orbits never re-phase; no window exists.
  if(Math.abs(dphi)<1e-6) return [];
  // Solve phi_now + dphi·dt = phi_req + TAU·k for dt over a range of turns.
  const wins=[];
  for(let k=-30;k<=80;k++){
    const dt=(phi_req-phi_now+TAU*k)/dphi;
    // Keep only future windows (0.004 yr guard skips a near-now solution).
    if(dt>0.004) wins.push(dt);
  }
  // Sort soonest first and describe each as source/target angles at departure.
  wins.sort((a,b)=>a-b);
  return wins.slice(0,count).map((dt,i)=>{
    const tL=now+dt;
    return{
      dt,
      label:`W${i+1}`,
      // Source angle at launch; target angle at the arrival time tL + t_tr.
      srcAng: src.angle+src.omega*tL,
      tgtAng: tgt.angle+tgt.omega*(tL+tr.tTr)
    };
  });
}
// Signed time to the closest ideal window (may be negative if just missed).
// Used to grade a launch: how far the actual departure is from perfect phasing.
function nearestWindowDt(src,tgt,tr,now){
  const phi_req=Math.PI-tgt.omega*tr.tTr;
  const theta_src=src.angle+src.omega*now;
  const theta_tgt=tgt.angle+tgt.omega*now;
  const phi_now=theta_tgt-theta_src;
  const dphi=tgt.omega-src.omega;
  if(Math.abs(dphi)<1e-6) return 0;
  // Scan turns both ways and keep the solution nearest to now (smallest |dt|).
  let bestDt=Infinity;
  for(let k=-60;k<=60;k++){
    const dt=(phi_req-phi_now+TAU*k)/dphi;
    if(Math.abs(dt)<Math.abs(bestDt)) bestDt=dt;
  }
  return bestDt;
}

/* Grades by absolute day error from nearest window */
// Grade table: first row whose maxD (days of phase error) covers the launch
// wins. g is the letter grade, c the display colour, f the flavour verdict.
const GRADES=[
  {maxD:0.5,  g:'A+',c:'#69f7a0',f:'Perfect. Textbook Hohmann launch.'},
  {maxD:1.5,  g:'A', c:'#69f7a0',f:'Excellent timing. Near-optimal trajectory.'},
  {maxD:4,    g:'A−',c:'#a8f0c0',f:'Great launch. Tiny correction burn needed.'},
  {maxD:9,    g:'B+',c:'#96c8ff',f:'Good timing. Small phase error.'},
  {maxD:18,   g:'B', c:'#96c8ff',f:'Decent window. Minor fuel penalty.'},
  {maxD:35,   g:'B−',c:'#96c8ff',f:"Acceptable. You'll arrive, just slightly late."},
  {maxD:65,   g:'C+',c:'#ffc832',f:'Off-window. Noticeable trajectory drift.'},
  {maxD:110,  g:'C', c:'#ffc832',f:'Poor timing. Expect a correction burn.'},
  {maxD:180,  g:'C−',c:'#ffa040',f:'Badly timed. Significant fuel wasted.'},
  {maxD:300,  g:'D+',c:'#ff7060',f:"Way off. You'll miss the target orbit."},
  {maxD:500,  g:'D', c:'#ff5050',f:'Very poor. Emergency corrections required.'},
  {maxD:800,  g:'D−',c:'#ff5050',f:'Catastrophic timing. Fuel budget blown.'},
  {maxD:1e9,  g:'F', c:'#ff3030',f:'You launched into the void. Good luck.'},
];
// Turn a signed time error into a graded score card. Converts years to days,
// picks the grade row, and labels the launch early, late, or on time.
function scorelaunch(dtYears){
  const dtDays=Math.abs(dtYears)*365.25;
  const g=GRADES.find(g=>dtDays<=g.maxD)||GRADES[GRADES.length-1];
  // 0.002 yr (~0.7 day) dead-band counts as on time.
  const early=dtYears<-0.002, late=dtYears>0.002;
  const timing=early?'early':late?'late':'on time';
  return{grade:g.g, dtDays, timing, color:g.c, flavor:g.f, fadeT:0};
}

/* ═════════════════════════════════════════════════════════════
   DRAWING
   ═════════════════════════════════════════════════════════════ */
// Cached starfield. Positions come from a cheap deterministic hash of the index
// (primes 7919/6271 spread them), so stars stay put between frames and only
// regenerate when the view size changes.
let _sc=null;
function getStars(){
  if(_sc&&_sc.W===W&&_sc.H===H) return _sc.d;
  const d=[];
  for(let i=0;i<300;i++) d.push({
    x:((i*7919+13337)%W), y:((i*6271+31337)%H),
    r:0.2+(i%6)*0.18, a:0.04+(i%5)*0.09
  });
  _sc={W,H,d}; return d;
}

// Paint the deep-space backdrop: fill, stars, a slow radar sweep line, and the
// glowing Sun at the view centre.
function drawBg(){
  ctx.fillStyle='#060810'; ctx.fillRect(0,0,W,H);
  getStars().forEach(s=>{
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,TAU);
    ctx.fillStyle=`rgba(200,210,240,${s.a})`; ctx.fill();
  });
  // radar sweep
  // Sweep angle advances slowly with sim time; drawn as a faint spoke.
  const sa=(simTime*0.26)%TAU;
  const rm=planets.length?Math.max(...planets.map(p=>p.r))*SCALE*1.1:200;
  ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(CX+Math.cos(sa)*rm,CY-Math.sin(sa)*rm);
  ctx.strokeStyle='rgba(150,200,255,0.07)'; ctx.lineWidth=1; ctx.stroke();
  // sun
  const sg=ctx.createRadialGradient(CX,CY,0,CX,CY,50);
  sg.addColorStop(0,'rgba(255,248,190,1)'); sg.addColorStop(0.18,'rgba(255,218,90,0.82)');
  sg.addColorStop(0.55,'rgba(255,155,45,0.14)'); sg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(CX,CY,50,0,TAU); ctx.fillStyle=sg; ctx.fill();
  ctx.beginPath(); ctx.arc(CX,CY,11,0,TAU); ctx.fillStyle='#fff9dc'; ctx.fill();
}

// Screen position of a planet at time t. Angle is analytic (angle0 + omega·t);
// y is flipped because canvas y grows downward. Defaults to the current simTime.
function pPos(p,t){
  t=t!==undefined?t:simTime;
  const ang=p.angle+p.omega*t;
  return{x:CX+Math.cos(ang)*p.r*SCALE, y:CY-Math.sin(ang)*p.r*SCALE, ang};
}

// Draw a planet's circular orbit. Selected orbits (source/target) are solid and
// coloured; the rest are faint dashed rings.
function drawOrbit(p){
  ctx.beginPath(); ctx.arc(CX,CY,p.r*SCALE,0,TAU);
  const sel=p===source||p===target;
  ctx.setLineDash(sel?[]:[1.5,7]);
  ctx.strokeStyle=p===source?'rgba(150,200,255,0.45)':p===target?'rgba(122,216,122,0.45)':'rgba(150,200,255,0.06)';
  ctx.lineWidth=sel?1.4:0.7;
  ctx.stroke(); ctx.setLineDash([]);
}

// Draw a planet disc with a shaded radial gradient. Source, target, and hovered
// planets also get a coloured glow halo and outline ring.
function drawPlanet(p,pos,alpha){
  alpha=alpha!==undefined?alpha:1;
  const isSrc=p===source,isTgt=p===target,isHov=p===hovered;
  const r=p.size*DPR;
  ctx.globalAlpha=alpha;
  if(alpha===1&&(isSrc||isTgt||isHov)){
    const gc=isSrc?'150,200,255':isTgt?'122,216,122':'200,220,255';
    const g=ctx.createRadialGradient(pos.x,pos.y,0,pos.x,pos.y,r*5);
    g.addColorStop(0,`rgba(${gc},0.32)`); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r*5,0,TAU); ctx.fillStyle=g; ctx.fill();
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r+4*DPR,0,TAU);
    ctx.strokeStyle=isSrc?'rgba(150,200,255,0.78)':isTgt?'rgba(122,216,122,0.78)':'rgba(255,255,255,0.25)';
    ctx.lineWidth=1.1; ctx.stroke();
  }
  const pg=ctx.createRadialGradient(pos.x-r*0.3,pos.y-r*0.3,0,pos.x,pos.y,r);
  pg.addColorStop(0,`hsl(${p.hue},75%,80%)`); pg.addColorStop(1,`hsl(${p.hue},55%,35%)`);
  ctx.beginPath(); ctx.arc(pos.x,pos.y,r,0,TAU); ctx.fillStyle=pg; ctx.fill();
  ctx.globalAlpha=1;
}

// Draw a planet's name beside it, with a dark drop shadow for legibility.
function drawLabel(p,pos){
  const col=p===source?'#96c8ff':p===target?'#7ad87a':`hsl(${p.hue},50%,68%)`;
  ctx.font=`600 ${10*DPR}px 'JetBrains Mono',monospace`;
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillText(p.name,pos.x+p.size*DPR+5*DPR+1,pos.y+1);
  ctx.fillStyle=col; ctx.fillText(p.name,pos.x+p.size*DPR+5*DPR,pos.y);
}

// Map eccentric anomaly E to a screen point on the transfer ellipse. In the
// ellipse's own frame the point is (a·cosE - c, b·sinE), with the Sun at the
// origin (a focus). Rotate by periAng (periapsis direction) and apply the
// world→screen transform with the y flip.
function eToXY(a_t,b_t,c_t,periAng,E){
  const xo=a_t*Math.cos(E)-c_t, yo=b_t*Math.sin(E);
  const cp=Math.cos(periAng), sp=Math.sin(periAng);
  return[CX+(xo*cp-yo*sp)*SCALE, CY-(xo*sp+yo*cp)*SCALE];
}
// Draw the transfer ellipse as a dashed outline. If drawArc, also stroke the
// half-ellipse the ship actually travels (periapsis to apoapsis) in solid gold.
function drawXferEllipse(tr,periAng,alpha,drawArc){
  const{a_t,b_t,c_t}=tr;
  ctx.globalAlpha=alpha;
  // Trace the whole ellipse in 180 segments across a full sweep of E.
  ctx.beginPath();
  for(let i=0;i<=180;i++){const[x,y]=eToXY(a_t,b_t,c_t,periAng,i*TAU/180);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}
  ctx.closePath(); ctx.setLineDash([4,5]);
  ctx.strokeStyle='rgba(255,200,50,0.42)'; ctx.lineWidth=0.9; ctx.stroke(); ctx.setLineDash([]);
  if(drawArc){
    ctx.globalAlpha=Math.min(alpha*3.2,1);
    // Ascending transfers start at periapsis (E=0); descending at apoapsis (E=pi).
    const E0=tr.asc?0:Math.PI;
    // Stroke only the half-orbit (E0 to E0+pi) the ship coasts along.
    ctx.beginPath();
    for(let i=0;i<=100;i++){const[x,y]=eToXY(a_t,b_t,c_t,periAng,E0+i*Math.PI/100);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}
    ctx.strokeStyle='#ffc832'; ctx.lineWidth=2.2*DPR; ctx.stroke();
  }
  ctx.globalAlpha=1;
}

/* Faint geometric construction of the transfer ellipse: major + minor axes,
   center, empty focus, and color-coded labels for a, b, c, r1, r2 */
function drawEllipseGeometry(tr,periAng){
  const{a_t,b_t,c_t,rPer,rApo,asc,r1,r2}=tr;
  const sp=Math.sin(periAng), cp=Math.cos(periAng);
  // ts: transform an ellipse-local point (Sun at origin) to screen coordinates.
  function ts(xo,yo){
    return [CX+(xo*cp-yo*sp)*SCALE, CY-(xo*sp+yo*cp)*SCALE];
  }
  // local +y direction projected to screen (unit vector)
  function perpY(p,n){ return [p[0]+(-sp)*n, p[1]+(-cp)*n]; }
  // local +x direction projected to screen (unit vector)
  function perpX(p,n){ return [p[0]+cp*n, p[1]+(-sp)*n]; }

  // Key construction points: Sun (occupied focus), periapsis, apoapsis, the
  // geometric centre, the empty focus (at 2c from the Sun), and the minor-axis
  // ends. Periapsis is at local +x, apoapsis at local -x.
  const sun=[CX,CY];
  const peri=ts(rPer,0);
  const apo=ts(-rApo,0);
  const center=ts(-c_t,0);
  const focus2=ts(-2*c_t,0);
  const minorTop=ts(-c_t,b_t);
  const minorBot=ts(-c_t,-b_t);

  ctx.save();

  // Major axis (dashed, faint orange)
  ctx.beginPath();
  ctx.moveTo(peri[0],peri[1]); ctx.lineTo(apo[0],apo[1]);
  ctx.setLineDash([3,5]);
  ctx.strokeStyle='rgba(255,144,80,0.18)'; ctx.lineWidth=0.9; ctx.stroke();

  // Minor axis (dashed, fainter orange)
  ctx.beginPath();
  ctx.moveTo(minorTop[0],minorTop[1]); ctx.lineTo(minorBot[0],minorBot[1]);
  ctx.strokeStyle='rgba(255,144,80,0.14)'; ctx.lineWidth=0.8; ctx.stroke();
  ctx.setLineDash([]);

  // Sun-to-other-focus tick (faint, indicates 2c)
  ctx.beginPath();
  ctx.moveTo(sun[0],sun[1]); ctx.lineTo(focus2[0],focus2[1]);
  ctx.setLineDash([1,3]);
  ctx.strokeStyle='rgba(180,190,220,0.15)'; ctx.lineWidth=0.7; ctx.stroke();
  ctx.setLineDash([]);

  // Center marker (orange dot)
  ctx.beginPath();
  ctx.arc(center[0],center[1],2.6*DPR,0,TAU);
  ctx.fillStyle='rgba(255,144,80,0.45)'; ctx.fill();

  // Empty focus marker (open circle + crosshair)
  ctx.beginPath();
  ctx.arc(focus2[0],focus2[1],3.2*DPR,0,TAU);
  ctx.strokeStyle='rgba(180,190,220,0.4)'; ctx.lineWidth=1; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(focus2[0]-2*DPR,focus2[1]); ctx.lineTo(focus2[0]+2*DPR,focus2[1]);
  ctx.moveTo(focus2[0],focus2[1]-2*DPR); ctx.lineTo(focus2[0],focus2[1]+2*DPR);
  ctx.stroke();

  // ── Labels ──
  ctx.font=`italic 600 ${13.5*DPR}px 'Cormorant Garamond',serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  // lbl: draw a serif math label with a dark shadow for contrast.
  function lbl(text,x,y,color){
    ctx.fillStyle='rgba(0,0,0,0.85)';
    ctx.fillText(text,x+1,y+1);
    ctx.fillStyle=color;
    ctx.fillText(text,x,y);
  }
  const PX=18*DPR;

  // "a" — center→apo half, BELOW the axis (-PX in local +y → +PX along (-sp,-cp))
  // perpY pushes +y in local, which means screen direction (-sp,-cp).
  // To go to the OTHER side, pass negative n.
  const aMid=ts(-c_t-a_t/2,0);
  const aLbl=perpY(aMid,-PX);
  lbl(`a = ${a_t.toFixed(3)}`, aLbl[0], aLbl[1], 'rgba(255,184,128,0.88)');

  // "b" — upper-half of minor axis, offset toward -x local (away from sun side)
  const bMid=ts(-c_t,b_t/2);
  const bLbl=perpX(bMid,-PX);
  lbl(`b = ${b_t.toFixed(3)}`, bLbl[0], bLbl[1], 'rgba(255,184,128,0.88)');

  // "c" — between sun and center, BELOW the axis to keep it clear of r1/r2 above
  const cMid=ts(-c_t/2,0);
  const cLbl=perpY(cMid,-PX);
  lbl(`c = ${c_t.toFixed(3)}`, cLbl[0], cLbl[1], 'rgba(190,200,225,0.7)');

  // r1, r2 — sun→source-orbit-intersection and sun→target-orbit-intersection
  // asc: source meets ellipse at perihelion (+x), target at aphelion (-x)
  // Place each radius label at the midpoint of its tangent radius.
  let r1X, r2X;
  if(asc){ r1X=rPer/2; r2X=-rApo/2; }
  else   { r1X=-rApo/2; r2X=rPer/2; }
  const r1Mid=ts(r1X,0);
  const r2Mid=ts(r2X,0);
  const r1Lbl=perpY(r1Mid,PX);   // above
  const r2Lbl=perpY(r2Mid,PX);   // above
  lbl(`r\u2081 = ${r1.toFixed(3)}`, r1Lbl[0], r1Lbl[1], 'rgba(150,200,255,0.78)');
  lbl(`r\u2082 = ${r2.toFixed(3)}`, r2Lbl[0], r2Lbl[1], 'rgba(150,200,255,0.78)');

  ctx.restore();
}

// Draw a small labelled circle at a burn point (Δv1 or Δv2).
function burnMark(x,y,col,lbl){
  const r=7*DPR;
  ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.fillStyle=col+'22'; ctx.fill();
  ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.stroke();
  ctx.fillStyle=col;
  ctx.font=`bold ${7*DPR}px 'JetBrains Mono',monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(lbl,x,y);
}

// Draw ghost markers for the upcoming launch windows: for each, the source
// position at departure, the target position at arrival, the transfer ellipse
// preview, and a countdown label in days. The nearest window (i===0) is boldest.
function drawWindows(){
  if(!source||!target||!xfer||!launchWindows.length) return;
  // Fade later windows; the first is fully opaque.
  const alphas=[0.85,0.42,0.2];
  const wCols=['#ffc832','rgba(255,200,50,0.55)','rgba(255,200,50,0.28)'];

  launchWindows.forEach((w,i)=>{
    const al=alphas[i];
    const sr=source.size*DPR, tr2=target.size*DPR;
    const sx=CX+Math.cos(w.srcAng)*source.r*SCALE;
    const sy=CY-Math.sin(w.srcAng)*source.r*SCALE;
    const tx=CX+Math.cos(w.tgtAng)*target.r*SCALE;
    const ty=CY-Math.sin(w.tgtAng)*target.r*SCALE;

    // Periapsis points along the source radius for ascending transfers, the
    // opposite way for descending; preview the ellipse for this window.
    const periAng=xfer.asc?w.srcAng:w.srcAng+Math.PI;
    drawXferEllipse(xfer,periAng,al*0.32,i===0);

    // Green ghost of the target at its arrival position.
    ctx.globalAlpha=al*0.65;
    const tg=ctx.createRadialGradient(tx,ty,0,tx,ty,tr2*3.5);
    tg.addColorStop(0,'rgba(122,216,122,0.4)'); tg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(tx,ty,tr2*3.5,0,TAU); ctx.fillStyle=tg; ctx.fill();
    ctx.beginPath(); ctx.arc(tx,ty,tr2,0,TAU); ctx.fillStyle='rgba(122,216,122,0.4)'; ctx.fill();
    ctx.globalAlpha=1;

    // Gold halo of the source at its departure position.
    ctx.globalAlpha=al;
    const hg=ctx.createRadialGradient(sx,sy,0,sx,sy,sr*4.5);
    hg.addColorStop(0,'rgba(255,200,50,0.32)'); hg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(sx,sy,sr*4.5,0,TAU); ctx.fillStyle=hg; ctx.fill();
    ctx.beginPath(); ctx.arc(sx,sy,sr+5*DPR,0,TAU);
    ctx.strokeStyle=wCols[i]; ctx.lineWidth=i===0?1.6:0.85; ctx.stroke();
    ctx.globalAlpha=1;

    // Window label (W1..W3) and its countdown in days above the source ghost.
    ctx.globalAlpha=al;
    const days=Math.round(w.dt*365.25);
    ctx.font=`bold ${10*DPR}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    const lx=sx, ly=sy-sr-7*DPR;
    ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillText(w.label,lx+0.8,ly+0.8);
    ctx.fillStyle=i===0?'#ffc832':'rgba(255,200,50,0.68)'; ctx.fillText(w.label,lx,ly);
    ctx.font=`${8*DPR}px 'JetBrains Mono',monospace`;
    ctx.fillStyle='rgba(255,200,50,0.55)'; ctx.fillText(days+'d',lx,ly+10*DPR);
    ctx.globalAlpha=1;

    // For the nearest window, draw a faint radius from the Sun to the departure point.
    if(i===0){
      ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(sx,sy);
      ctx.setLineDash([2,6]); ctx.strokeStyle='rgba(255,200,50,0.12)'; ctx.lineWidth=0.8;
      ctx.stroke(); ctx.setLineDash([]);
    }
  });
}

// Draw the bottom prompt box that walks the user through the next action. The
// text depends on how far selection has progressed and whether hop mode is on.
function drawGuidance(){
  // Hide while a transfer is flying, or once everything is selected in normal mode.
  if(ship&&!ship.arrived) return;
  if(!hopMode&&source&&target&&ship) return;

  // Choose the prompt lines for the current selection stage.
  let line1='', line2='', sub='';
  if(hopMode){
    if(!source){
      line1='HOP MODE ACTIVE';
      line2='① SELECT HOME PLANET';
      sub='Your spacecraft will park there and await your first transfer.';
    } else if(!target){
      line1=`PARKED AT ${source.name.toUpperCase()}`;
      line2='② SELECT DESTINATION';
      sub='Choose any other planet to compute the Hohmann transfer.';
    } else {
      line1=`${source.name} → ${target.name}`;
      line2=`${launchWindows.length} LAUNCH WINDOWS SHOWN`;
      sub='Wait for the W1 marker, then press ▶ Launch.';
    }
  } else {
    if(!source){
      line1='① SELECT SOURCE PLANET';
      sub='Click any planet to begin the transfer calculation.';
    } else if(!target){
      line1=`SOURCE: ${source.name.toUpperCase()}`;
      line2='② SELECT TARGET PLANET';
      sub='Click another planet to compute the Hohmann transfer.';
    } else if(!ship){
      line1=`${source.name} → ${target.name}`;
      line2=`${launchWindows.length} LAUNCH WINDOWS SHOWN`;
      sub='Ghost markers show optimal launch positions. Press ▶ Launch when ready.';
    }
  }

  // Size the box to the number of lines and draw it near the bottom centre.
  const bw=Math.min(W*0.6,420), bx=CX-bw/2;
  const lineH=14, subH=11, pad=13;
  const linesCount=(line1?1:0)+(line2?1:0);
  const bh=linesCount*lineH+subH+pad*2+4;
  const by=H*0.82;

  ctx.save();
  ctx.globalAlpha=0.88;
  ctx.fillStyle='rgba(8,12,22,0.92)';
  ctx.strokeStyle='rgba(150,200,255,0.16)';
  ctx.lineWidth=1;
  rRect(ctx,bx,by,bw,bh,4); ctx.fill(); ctx.stroke();
  ctx.globalAlpha=1;

  let ty=by+pad;
  ctx.textAlign='center'; ctx.textBaseline='top';
  if(line1){
    ctx.font=`${source?'500':'700'} 10.5px 'JetBrains Mono',monospace`;
    ctx.fillStyle=source?'rgba(150,200,255,0.7)':'#96c8ff';
    ctx.fillText(line1.toUpperCase(),CX,ty);
    ty+=lineH;
  }
  if(line2){
    ctx.font=`700 10.5px 'JetBrains Mono',monospace`;
    ctx.fillStyle='#96c8ff';
    ctx.fillText(line2.toUpperCase(),CX,ty);
    ty+=lineH+2;
  }
  ty+=2;
  ctx.font=`400 9.5px 'JetBrains Mono',monospace`;
  ctx.fillStyle='rgba(164,176,206,0.75)';
  ctx.fillText(sub,CX,ty);
  ctx.restore();
}

// Draw the first-burn Δv arrow at the departure point, shown briefly after
// launch then fading out. The arrow points along the tangent (the burn is
// prograde) and its length scales with the burn fraction dv1/vc1.
function drawBurnVector(){
  if(!ship||!xfer) return;
  // Only show for the first 12% of the transfer, fading over that window.
  const dt=simTime-ship.launchT;
  if(dt<0||dt>xfer.tTr*0.12) return;
  const fade=dt<0.001?1:Math.max(0,1-dt/(xfer.tTr*0.12));

  // Departure point on the source orbit, and the prograde tangent direction.
  const lx=CX+Math.cos(ship.launchAng)*xfer.r1*SCALE;
  const ly=CY-Math.sin(ship.launchAng)*xfer.r1*SCALE;
  // Tangent is 90 degrees ahead of the radius; sign follows ascent/descent.
  const tanAng=ship.launchAng+Math.PI/2*(xfer.asc?1:-1);
  // Arrow length in pixels, proportional to burn fraction, capped to the view.
  const dvPixels=Math.min(xfer.dv1/xfer.vc1*xfer.r1*SCALE*5, Math.min(W,H)*0.32);

  const vx=lx+Math.cos(tanAng)*dvPixels;
  const vy=ly-Math.sin(tanAng)*dvPixels;

  ctx.save();
  ctx.globalAlpha=fade*0.92;
  const gl=ctx.createRadialGradient(lx,ly,0,lx,ly,dvPixels*1.1);
  gl.addColorStop(0,'rgba(92,216,232,0.14)'); gl.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(lx,ly,dvPixels*1.1,0,TAU); ctx.fillStyle=gl; ctx.fill();

  ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(vx,vy);
  ctx.strokeStyle='#5cd8e8'; ctx.lineWidth=2.5*DPR; ctx.lineCap='round'; ctx.stroke();

  // Arrowhead as a filled triangle at the vector tip.
  const headLen=10*DPR, headAng=0.42;
  ctx.beginPath();
  ctx.moveTo(vx,vy);
  ctx.lineTo(vx-headLen*Math.cos(tanAng-headAng), vy+headLen*Math.sin(tanAng-headAng));
  ctx.lineTo(vx-headLen*Math.cos(tanAng+headAng), vy+headLen*Math.sin(tanAng+headAng));
  ctx.closePath(); ctx.fillStyle='#5cd8e8'; ctx.fill();

  ctx.font=`bold ${9*DPR}px 'JetBrains Mono',monospace`;
  // Δv1 value in km/s, offset perpendicular to the arrow so it stays readable.
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  const mx=(lx+vx)/2, my=(ly+vy)/2;
  const nx=-Math.sin(tanAng)*12*DPR, ny=Math.cos(tanAng)*12*DPR;
  ctx.fillStyle='rgba(0,0,0,0.6)';
  ctx.fillText(`Δv₁ = ${(xfer.dv1*AU2KMS).toFixed(2)} km/s`, mx+nx+0.8, my-ny+0.8);
  ctx.fillStyle='#9ce8f4';
  ctx.fillText(`Δv₁ = ${(xfer.dv1*AU2KMS).toFixed(2)} km/s`, mx+nx, my-ny);
  ctx.restore();
}

// Draw the launch-grade card after a launch: the big letter grade, the timing
// error, and a flavour verdict. It holds for a few seconds then fades and clears.
function drawScoreOverlay(){
  if(!launchScore) return;
  // Advance the fade timer; hold fully, then fade out and drop the card.
  launchScore.fadeT+=0.016;
  const hold=3.2, fade=2;
  let alpha=1;
  if(launchScore.fadeT>hold) alpha=Math.max(0,1-(launchScore.fadeT-hold)/fade);
  if(alpha<=0){ launchScore=null; return; }

  const sc=launchScore;
  const bw=Math.min(W*0.5,340), bh=152;
  const bx=CX-bw/2, by=H*0.18;

  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(8,12,22,0.95)';
  ctx.strokeStyle=sc.color+'55';
  ctx.lineWidth=1.5;
  rRect(ctx,bx,by,bw,bh,6); ctx.fill(); ctx.stroke();
  ctx.fillStyle=sc.color+'30'; ctx.fillRect(bx+1,by+1,bw-2,3);

  ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.font=`700 ${56*DPR}px 'Cormorant Garamond',serif`;
  ctx.fillStyle=sc.color;
  ctx.shadowColor=sc.color; ctx.shadowBlur=20*DPR;
  ctx.fillText(sc.grade, bx+bw*0.34, by+22);
  ctx.shadowBlur=0;

  const dStr=sc.dtDays<1 ? `${(sc.dtDays*24).toFixed(1)} hr` : `${sc.dtDays.toFixed(1)} days`;
  ctx.font=`${9*DPR}px 'JetBrains Mono',monospace`;
  ctx.textAlign='left';
  ctx.fillStyle='rgba(150,200,255,0.65)';
  ctx.fillText('LAUNCH TIMING', bx+bw*0.54, by+24);
  ctx.fillStyle=sc.color;
  ctx.font=`700 ${14*DPR}px 'JetBrains Mono',monospace`;
  ctx.fillText(dStr+' '+sc.timing, bx+bw*0.54, by+40);
  ctx.font=`${10*DPR}px 'JetBrains Mono',monospace`;
  ctx.fillStyle='rgba(200,210,230,0.55)';
  const windowStr=sc.dtDays<0.5?'On window':'Off window by '+dStr;
  ctx.fillText(windowStr, bx+bw*0.54, by+62);

  ctx.strokeStyle='rgba(150,200,255,0.1)';
  ctx.beginPath(); ctx.moveTo(bx+14,by+92); ctx.lineTo(bx+bw-14,by+92); ctx.stroke();

  ctx.font=`400 italic ${10*DPR}px 'Cormorant Garamond',serif`;
  ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillStyle='rgba(200,210,230,0.7)';
  ctx.fillText(sc.flavor, bx+bw/2, by+102);

  ctx.font=`${8*DPR}px 'JetBrains Mono',monospace`;
  ctx.fillStyle='rgba(110,122,152,0.45)';
  ctx.fillText('LAUNCH EVALUATION // HOHMANN.SCORE', bx+bw/2, by+128);
  ctx.restore();
}

// Trace a rounded rectangle path (used by the HUD panels).
function rRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

// Draw the spacecraft: its fading trail, the hull rotated to its heading, and
// an engine plume while under way. A green halo marks a parked ship in hop mode.
function drawShip(){
  if(!ship||(!ship.x&&ship.x!==0)) return;

  // Trail
  // Fade the trail from tail to head so recent motion is brightest.
  if(ship.trail.length>1){
    for(let i=1;i<ship.trail.length;i++){
      const t=i/ship.trail.length;
      ctx.beginPath();
      ctx.moveTo(ship.trail[i-1].x,ship.trail[i-1].y);
      ctx.lineTo(ship.trail[i].x,ship.trail[i].y);
      ctx.strokeStyle=`rgba(255,200,80,${t*0.5})`;
      ctx.lineWidth=1+t*1.2; ctx.stroke();
    }
  }

  // Heading: from the last two trail points while flying; from the orbital
  // tangent once parked; from the launch tangent before any trail exists.
  let heading=0;
  if(ship.trail.length>=2){
    const a=ship.trail[ship.trail.length-2];
    const b=ship.trail[ship.trail.length-1];
    heading=Math.atan2(b.y-a.y,b.x-a.x);
  } else if(ship.arrived){
    const ang=ship.arriveAng+ship.arriveOmega*(simTime-ship.arriveT);
    heading=ang+Math.PI/2;
  } else {
    heading=ship.launchAng+(xfer&&xfer.asc?Math.PI/2:-Math.PI/2);
  }

  if(hopMode&&ship.arrived){
    const g=ctx.createRadialGradient(ship.x,ship.y,0,ship.x,ship.y,18*DPR);
    g.addColorStop(0,'rgba(122,216,122,0.28)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(ship.x,ship.y,18*DPR,0,TAU); ctx.fillStyle=g; ctx.fill();
  }
  const eg=ctx.createRadialGradient(ship.x,ship.y,0,ship.x,ship.y,14*DPR);
  eg.addColorStop(0,'rgba(255,220,120,0.24)'); eg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(ship.x,ship.y,14*DPR,0,TAU); ctx.fillStyle=eg; ctx.fill();

  // Move to the ship and rotate the local frame to its heading, then draw.
  ctx.save();
  ctx.translate(ship.x,ship.y);
  ctx.rotate(heading);
  const s=DPR;
  // Engine plume, only while under way; it flickers via a sine of sim time.
  if(!ship.arrived){
    const plumeLen=10*s, plumeW=4*s;
    const pg=ctx.createLinearGradient(-plumeLen,0,0,0);
    pg.addColorStop(0,'rgba(100,200,255,0)');
    pg.addColorStop(0.4,'rgba(150,230,255,0.5)');
    pg.addColorStop(1,'rgba(220,240,255,0.9)');
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(-plumeLen,-plumeW*0.5*(0.6+0.4*Math.sin(simTime*80)));
    ctx.lineTo(-plumeLen*1.4,0);
    ctx.lineTo(-plumeLen, plumeW*0.5*(0.6+0.4*Math.sin(simTime*80+1)));
    ctx.closePath(); ctx.fillStyle=pg; ctx.fill();
  }
  // Hull: an arrow-like polygon pointing along +x (the heading direction).
  ctx.beginPath();
  ctx.moveTo( 9*s,  0); ctx.lineTo( 2*s,  3.5*s); ctx.lineTo(-5*s,  2.5*s);
  ctx.lineTo(-3*s,  0); ctx.lineTo(-5*s, -2.5*s); ctx.lineTo( 2*s, -3.5*s);
  ctx.closePath(); ctx.fillStyle='#c8dcf0'; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4*s, 0, 2.5*s, 1.5*s, 0, 0, TAU);
  ctx.fillStyle='rgba(180,230,255,0.75)'; ctx.fill();
  ctx.strokeStyle='rgba(150,200,255,0.45)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(2*s,3.5*s); ctx.lineTo(-5*s,2.5*s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2*s,-3.5*s); ctx.lineTo(-5*s,-2.5*s); ctx.stroke();
  ctx.restore();
}

// Advance the flying ship along the transfer ellipse. Position is analytic:
// mean anomaly grows linearly with elapsed time, Kepler's equation gives the
// eccentric anomaly, and eToXY maps it to the screen. On arrival the ship
// circularises onto the target orbit (and hop mode logs the leg).
function updateShip(){
  if(!ship||ship.arrived) return;
  const dt=simTime-ship.launchT;
  // Before the launch instant, hold the ship at the departure point.
  if(dt<=0){
    ship.x=CX+Math.cos(ship.launchAng)*xfer.r1*SCALE;
    ship.y=CY-Math.sin(ship.launchAng)*xfer.r1*SCALE;
    return;
  }
  // After one half-period the ship reaches the far tangent and arrives.
  if(dt>=xfer.tTr){
    ship.arrived=true;
    // Arrival is half a turn from launch, at the target radius.
    ship.arriveAng=ship.launchAng+Math.PI;
    ship.arriveT=simTime;
    // Post-arrival angular rate is the target orbit's: omega = TAU/r^1.5.
    ship.arriveOmega=TAU/Math.pow(xfer.r2,1.5);
    if(hopMode){
      // Log this leg, then make the target the new home and clear the target.
      hopLog.push({
        from: hopHomePlanet ? hopHomePlanet.name : source.name,
        to: target.name,
        toColor: target.color,
        fromColor: source.color,
        grade: launchScore ? launchScore.grade : '—',
        color: launchScore ? launchScore.color : '#c8d0e0',
        dtDays: launchScore ? launchScore.dtDays : 0,
        timing: launchScore ? launchScore.timing : '',
        dvTot: xfer.dvTot,
      });
      hopHomePlanet=target;
      setTbar(true,`✓ ARRIVED AT ${target.name.toUpperCase()} — SELECT NEXT DESTINATION`, true);
      setStatus(`AT ${target.name.toUpperCase()} — HOP ${hopLog.length} COMPLETE`);
      source=target; target=null; xfer=null; launchWindows=[];
      setBtnLaunch(false);
      setEqPanelActive(false);
      renderMath();
    } else {
      // Normal mode: just report the completed transfer.
      setTbar(true,'✓ TRANSFER COMPLETE — SPACECRAFT IN TARGET ORBIT', true);
      setStatus('TRANSFER COMPLETE');
    }
    return;
  }
  // Mid-flight: mean anomaly goes from E0 to E0+pi over the half-period, so the
  // fraction dt/tTr scaled by pi is the mean-anomaly progress. Solve Kepler for
  // the eccentric anomaly, then map to a screen point on the ellipse.
  const E=solveKepler((xfer.asc?0:Math.PI)+Math.PI*(dt/xfer.tTr), xfer.e_t);
  const xo=xfer.a_t*Math.cos(E)-xfer.c_t, yo=xfer.b_t*Math.sin(E);
  const cp=Math.cos(ship.periAng), sp=Math.sin(ship.periAng);
  const nx=CX+(xo*cp-yo*sp)*SCALE;
  const ny=CY-(xo*sp+yo*cp)*SCALE;
  // Append to the trail, keeping at most 120 points.
  ship.trail.push({x:nx,y:ny});
  if(ship.trail.length>120) ship.trail.shift();
  ship.x=nx; ship.y=ny;
}

/* ═════════════════════════════════════════════════════════════
   MAIN LOOP
   ═════════════════════════════════════════════════════════════ */
// fc counts frames per second window; lastFT marks that window's start.
let fc=0, lastFT=performance.now();
// The per-frame update and render. Advances sim time by real elapsed time
// scaled by BASE_TS and the speed slider, moves the ship, refreshes the launch
// windows when idle, then draws every layer back to front.
function frame(now){
  // Time step in real seconds since the last frame.
  if(lastT===null) lastT=now;
  const dtR=(now-lastT)/1000; lastT=now;

  // Advance sim time unless paused; slider sets years per real second.
  if(!paused){
    const spd=parseFloat(document.getElementById('spSlider').value);
    simTime+=dtR*BASE_TS*spd;
  }

  // Arrived ship coasts on the target orbit; otherwise step along the ellipse.
  if(ship&&ship.arrived){
    const ang=ship.arriveAng+ship.arriveOmega*(simTime-ship.arriveT);
    const r=ship.r2;
    ship.x=CX+Math.cos(ang)*r*SCALE;
    ship.y=CY-Math.sin(ang)*r*SCALE;
  } else updateShip();

  // Recompute launch windows only while no ship is in flight.
  if(source&&target&&xfer&&(!ship||ship.arrived))
    launchWindows=computeWindows(source,target,xfer,simTime);

  // Back to front: background, orbits, then the launch-window ghosts.
  drawBg();
  planets.forEach(p=>drawOrbit(p));
  drawWindows();

  // Geometry overlay: faint axes + labels on whichever ellipse is "active"
  if(xfer){
    let geomAng=null;
    if(ship){
      geomAng=xfer.asc?ship.launchAng:ship.launchAng+Math.PI;
    } else if(launchWindows.length>0){
      const w=launchWindows[0];
      geomAng=xfer.asc?w.srcAng:w.srcAng+Math.PI;
    }
    if(geomAng!==null) drawEllipseGeometry(xfer,geomAng);
  }

  // With a ship in flight, draw its full ellipse and both burn markers.
  if(ship&&xfer){
    const pA=xfer.asc?ship.launchAng:ship.launchAng+Math.PI;
    drawXferEllipse(xfer,pA,1,true);
    burnMark(CX+Math.cos(ship.launchAng)*xfer.r1*SCALE,CY-Math.sin(ship.launchAng)*xfer.r1*SCALE,'#5cd8e8','Δv₁');
    burnMark(CX+Math.cos(ship.launchAng+Math.PI)*xfer.r2*SCALE,CY-Math.sin(ship.launchAng+Math.PI)*xfer.r2*SCALE,'#ffc832','Δv₂');
  }

  // Planets and labels on top of orbits, then the ship and its HUD overlays.
  planets.forEach(p=>{const pos=pPos(p);drawPlanet(p,pos);drawLabel(p,pos)});
  drawShip();
  drawBurnVector();
  drawScoreOverlay();
  drawGuidance();

  // Once per second, publish the frame count as FPS.
  fc++; const n2=performance.now();
  if(n2-lastFT>=1000){document.getElementById('fpsRead').textContent=fc;fc=0;lastFT=n2}
  // Update the topbar readouts and schedule the next frame.
  document.getElementById('bodyCount').textContent=planets.length;
  document.getElementById('timeRead').textContent=simTime.toFixed(2);
  requestAnimationFrame(frame);
}

/* ═════════════════════════════════════════════════════════════
   INPUT
   ═════════════════════════════════════════════════════════════ */
// Hover: pick the nearest planet within 22 px and show its orbital data.
cvs.addEventListener('mousemove',e=>{
  const rc=cvs.getBoundingClientRect();
  const mx=e.clientX-rc.left, my=e.clientY-rc.top;
  // Find the closest planet under the cursor within the pick radius.
  hovered=null; let md=22;
  planets.forEach(p=>{
    const pos=pPos(p);
    const d=Math.hypot(pos.x-mx,pos.y-my);
    if(d<md){md=d;hovered=p}
  });
  const hb=document.getElementById('hoverbox');
  if(hovered){
    hb.innerHTML=`<strong style="color:${hovered.color}">${hovered.name}</strong>  r=${hovered.r.toFixed(3)} AU  ·  v=${(hovered.speed*AU2KMS).toFixed(2)} km/s  ·  T=${hovered.period.toFixed(2)} yr`;
    cvs.style.cursor='pointer';
  } else {
    hb.textContent='hover over a planet';
    cvs.style.cursor='crosshair';
  }
});
// Leaving the canvas clears the hover state and resets the hover box.
cvs.addEventListener('mouseleave',()=>{hovered=null;document.getElementById('hoverbox').textContent='hover over a planet';});

// Click a planet to select it. Behaviour differs between hop mode (park, then
// pick destinations) and normal mode (pick source, then target).
cvs.addEventListener('click',()=>{
  if(!hovered) return;
  if(hopMode){
    // First hop click: park a stationary ship on the chosen home planet.
    if(!source){
      source=hovered; hopHomePlanet=hovered;
      const pos=pPos(hovered);
      // launchT is set one unit in the past so the ship reads as already arrived.
      ship={
        x:pos.x, y:pos.y, launchAng:pos.ang, periAng:pos.ang,
        launchT:simTime-1, trail:[], arrived:true,
        arriveAng:pos.ang, arriveT:simTime,
        arriveOmega:hovered.omega, r2:hovered.r
      };
      setStatus(`PARKED AT ${hovered.name.toUpperCase()} — SELECT DESTINATION`);
      renderMath();
    // Second hop click: choose a destination and compute its transfer.
    } else if(hovered!==source&&!target&&ship&&ship.arrived){
      target=hovered;
      xfer=computeXfer(source.r,target.r);
      launchWindows=computeWindows(source,target,xfer,simTime);
      setStatus(`${source.name.toUpperCase()} → ${target.name.toUpperCase()} — PRESS ▶ LAUNCH`);
      setBtnLaunch(true);
      setEqPanelActive(true);
      renderMath();
    }
    return;
  }
  // Normal mode, first click: set the source orbit.
  if(!source){
    source=hovered;
    setStatus(`SOURCE: ${source.name.toUpperCase()} — SELECT TARGET`);
    renderMath();
  // Normal mode, second click: set the target and compute the transfer.
  } else if(hovered!==source&&!target){
    target=hovered;
    xfer=computeXfer(source.r,target.r);
    launchWindows=computeWindows(source,target,xfer,simTime);
    setStatus('TRANSFER COMPUTED — PRESS ▶ LAUNCH');
    setBtnLaunch(true);
    setEqPanelActive(true);
    renderMath();
  }
});

// Touch support — tap = click on nearest planet
// Set hovered from the touch point (wider 28 px radius), then synthesise a click.
cvs.addEventListener('touchstart',e=>{
  if(e.touches.length!==1) return;
  e.preventDefault();
  const rc=cvs.getBoundingClientRect();
  const t=e.touches[0];
  const mx=t.clientX-rc.left, my=t.clientY-rc.top;
  hovered=null; let md=28;
  planets.forEach(p=>{
    const pos=pPos(p);
    const d=Math.hypot(pos.x-mx,pos.y-my);
    if(d<md){md=d;hovered=p}
  });
  if(hovered) cvs.dispatchEvent(new MouseEvent('click'));
},{passive:false});

// Keyboard shortcuts: Space pauses, C clears the selection, Enter launches.
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT') return;
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  else if(e.key==='c'||e.key==='C'){ clearSel(); }
  else if(e.key==='Enter'){ if(!document.getElementById('btnLaunch').disabled) launch(); }
});

// Toggle the paused flag and update the sim-status badge.
function togglePause(){
  paused=!paused;
  const el=document.getElementById('simStatus');
  el.textContent=paused?'Paused':'Sim Active';
  el.className='sys-status'+(paused?' paused':'');
}

// Fire the transfer now. Grade the timing against the nearest ideal window,
// then create the ship at the source's current angle and start it coasting.
function launch(){
  if(!source||!target||!xfer) return;
  // Launch from wherever the source planet is right now.
  const pos=pPos(source);
  const actualAng=pos.ang;
  // Grade how far this instant is from the perfect phasing.
  const dtYears=nearestWindowDt(source,target,xfer,simTime);
  launchScore=scorelaunch(dtYears);
  // periAng orients the ellipse so periapsis lies along the departure radius.
  ship={launchAng:actualAng, periAng:xfer.asc?actualAng:actualAng+Math.PI,
        launchT:simTime, trail:[], arrived:false, x:0, y:0, r2:xfer.r2};
  launchWindows=[];
  setTbar(true,'⚡ TRANSFER IN PROGRESS — SPACECRAFT EN ROUTE');
  setStatus('TRANSFERRING'); setBtnLaunch(false);
}

// Toggle hop mode on or off. Either way, reset all selection and ship state and
// update the button and status to the mode's starting prompt.
function toggleHopMode(){
  hopMode=!hopMode;
  const btn=document.getElementById('btnHop');
  if(hopMode){
    hopLog=[]; hopHomePlanet=null;
    btn.classList.add('active');
    btn.innerHTML='&#11041; Hopping';
    source=target=xfer=ship=null; launchWindows=[]; launchScore=null;
    setBtnLaunch(false); setTbar(false);
    setEqPanelActive(false);
    setStatus('HOP MODE — SELECT HOME PLANET');
    renderMath();
  } else {
    btn.classList.remove('active');
    btn.innerHTML='&#11041; Hop';
    hopLog=[]; hopHomePlanet=null;
    source=target=xfer=ship=null; launchWindows=[]; launchScore=null;
    setBtnLaunch(false); setTbar(false);
    setEqPanelActive(false);
    setStatus('AWAITING SELECTION');
    renderMath();
  }
}

// Clear the current selection and ship without leaving the current mode.
function clearSel(){
  source=target=xfer=ship=null; launchWindows=[]; launchScore=null;
  if(hopMode){ hopLog=[]; hopHomePlanet=null; setStatus('HOP MODE — SELECT HOME PLANET'); }
  else setStatus('AWAITING SELECTION');
  setBtnLaunch(false); setTbar(false);
  setEqPanelActive(false);
  renderMath();
}

// Speed slider: reflect the chosen multiplier in the readout label.
document.getElementById('spSlider').addEventListener('input',function(){
  const v=parseFloat(this.value);
  document.getElementById('spVal').textContent=(v<1?v.toFixed(2):v%1===0?v:v.toFixed(1))+'\u00d7';
});

// Mobile drawer
// Open or close the slide-in math panel and its backdrop on narrow screens.
function toggleMathDrawer(){
  const p=document.getElementById('mathpanel');
  const f=document.getElementById('fabMath');
  const b=document.getElementById('drawerBackdrop');
  const open=!p.classList.contains('open');
  p.classList.toggle('open',open);
  f.classList.toggle('open',open);
  b.classList.toggle('show',open);
}
// Force the math drawer closed (used on preset load at narrow widths).
function closeMathDrawer(){
  document.getElementById('mathpanel').classList.remove('open');
  document.getElementById('fabMath').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('show');
}

/* ═════════════════════════════════════════════════════════════
   MATH PANEL RENDERING (live values, color-coded variable names)
   ═════════════════════════════════════════════════════════════ */
// Render a LaTeX string to HTML, falling back to a code span on error.
function K(s,d=false){
  try{return katex.renderToString(s,{throwOnError:false,displayMode:d})}
  catch(e){return`<code>${s}</code>`}
}
// Number formatters: 3 and 4 decimals; fk converts AU/yr to km/s; fD to days.
const f3=v=>v.toFixed(3), f4=v=>v.toFixed(4);
const fk=v=>(v*AU2KMS).toFixed(3);
const fD=yr=>(yr*365.25).toFixed(0);

// Colour code for each variable, matching the KaTeX reference (katex.js).
const CC={
  mu:'#ffc832', r:'#96c8ff', v:'#7ad87a', a:'#ff9050',
  dv:'#5cd8e8', t:'#ffc832', phi:'#d870c8', om:'#d870c8'
};

// Build the hop-log panel: one row per completed leg, plus a total-Δv and
// best-grade summary. Returns empty when hop mode is off.
function hopLogHTML(){
  if(!hopMode) return '';
  // Sum every leg's total Δv, converted to km/s.
  const totalDv=(hopLog.reduce((a,h)=>a+h.dvTot,0)*AU2KMS).toFixed(3);
  const gradeColors={'A+':'#69f7a0','A':'#69f7a0','A−':'#a8f0c0','B+':'#96c8ff','B':'#96c8ff','B−':'#96c8ff','C+':'#ffc832','C':'#ffc832','C−':'#ffa040','D+':'#ff7060','D':'#ff5050','D−':'#ff5050','F':'#ff3030'};
  const rows=hopLog.length===0
    ? `<div style="font-size:11px;color:var(--text-faint);padding:8px 0;text-align:center">No hops yet</div>`
    : hopLog.map((h,i)=>`
      <div style="display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid rgba(22,34,64,0.4)">
        <div style="font-size:10.5px;color:var(--text-faint);min-width:18px;font-weight:700">${i+1}</div>
        <div style="flex:1;font-size:11.5px;line-height:1.5">
          <span style="color:${h.fromColor};font-weight:600">${h.from}</span>
          <span style="color:var(--text-faint)"> → </span>
          <span style="color:${h.toColor};font-weight:600">${h.to}</span>
          <span style="color:var(--text-faint);font-size:10px;margin-left:4px">${(h.dvTot*AU2KMS).toFixed(2)} km/s</span>
        </div>
        <div style="font-size:15px;font-weight:700;font-family:'Cormorant Garamond',serif;color:${h.color||gradeColors[h.grade]||'#c8d0e0'}">${h.grade}</div>
      </div>`).join('');
  return `
    <div class="msec" style="background:rgba(122,216,122,0.04);border-left:3px solid rgba(122,216,122,0.35)">
      <div class="msec-head">
        <span style="color:#7ad87a">⬡ Hop Log</span>
        <span class="mh-tag">${hopLog.length} HOPS${hopLog.length>0?' · '+totalDv+' km/s':''}</span>
      </div>
      ${rows}
      ${hopLog.length>0?`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
        <div class="scard" style="border-left:3px solid rgba(122,216,122,0.55)">
          <div class="sl">Total Δv</div>
          <div class="sv" style="color:#7ad87a;font-size:14px">${totalDv}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left:3px solid rgba(122,216,122,0.55)">
          <div class="sl">Best grade</div>
          <div class="sv" style="color:${gradeColors[hopLog.reduce((b,h)=>{const gi=g=>Object.keys(gradeColors).indexOf(g);return gi(h.grade)<gi(b)?h.grade:b;},hopLog[0].grade)]||'#c8d0e0'};font-size:14px;font-family:'Cormorant Garamond',serif">${hopLog.reduce((b,h)=>{const gi=g=>Object.keys(gradeColors).indexOf(g);return gi(h.grade)<gi(b)?h.grade:b;},hopLog[0].grade)}</div>
        </div>
      </div>`:''}
    </div>`;
}

// Render the live computation panel. Its content has three stages: no source
// picked (intro), source only (circular speed), and both picked (the full
// eight-step Hohmann walkthrough with live values and launch windows).
function renderMath(){
  const el=document.getElementById('mathcontent');

  // Stage 1: nothing selected yet, show the getting-started copy.
  if(!source){
    el.innerHTML=hopLogHTML()+`
      <div class="msec">
        <div class="msec-head"><span>Getting Started</span><span class="mh-tag">SELECT.A.PLANET</span></div>
        <div class="ph">
          <span class="ic">Orbital Mechanics</span>
          ${hopMode
            ?'Select your home planet to park your spacecraft there. Then pick any destination and launch repeated transfers in a chain.'
            :'Click any planet to set the source orbit, then click another to compute the Hohmann transfer and reveal the launch windows.'}
        </div>
      </div>
      <div class="msec">
        <div class="msec-head"><span>What this calculator does</span></div>
        <div style="font-size:11.5px;color:var(--text-dim);line-height:1.7">
          A <b style="color:var(--text-bright)">Hohmann transfer</b> is the lowest-fuel route between two circular coplanar orbits. The spacecraft burns once to enter an elliptical transfer orbit tangent to both circles, coasts, then burns again to circularise at the target.
          <br><br>
          The floating panel above shows the five equations that fully describe the maneuver. After you pick a source and target, this panel fills with the live computed values, the three nearest launch windows, and an eight-step walkthrough of the math.
        </div>
      </div>`;
    return;
  }

  // Stage 2: source picked, no target; show the source orbit and its v_c1.
  if(!target){
    el.innerHTML=hopLogHTML()+`
      <div class="msec">
        <div class="msec-head"><span>Selected Orbit</span></div>
        <div class="ocards">
          <div class="ocard src">
            <div class="ol">${hopMode?'Parked At':'Source'}</div>
            <div class="on" style="color:${source.color}">${source.name}</div>
            <div class="ov"><span style="color:${CC.r}">r₁</span> = ${f3(source.r)} AU<br><span style="color:${CC.v}">v</span> = ${fk(source.speed)} km/s<br><span style="color:${CC.t}">T</span> = ${source.period.toFixed(3)} yr</div>
          </div>
          <div class="ocard dim">
            <div class="ol">Target</div>
            <div class="on" style="color:var(--text-faint)">—</div>
            <div class="ov">click another planet</div>
          </div>
        </div>
      </div>
      <div class="msec">
        <div class="msec-head"><span>Circular speed at <span style="color:${CC.r}">r₁</span></span></div>
        <div style="padding:6px 0;overflow-x:auto">${K(`\\textcolor{${CC.v}}{v_{c1}}=\\sqrt{4\\pi^2/\\textcolor{${CC.r}}{${f3(source.r)}}}=${f4(source.speed)}\\;\\text{AU/yr}`,true)}</div>
        <div style="font-size:12px;color:${CC.v};margin-top:5px;font-weight:700">= ${fk(source.speed)} km/s</div>
      </div>`;
    return;
  }

  // Stage 3: both orbits picked; pull the computed transfer and build the walkthrough.
  const tr=xfer;
  const{r1,r2,a_t,b_t,c_t,e_t,asc,vc1,vc2,v1,v2,dv1,dv2,dvTot,tTr}=tr;
  // Required lead angle for the launch-window explanation, in degrees.
  const phi_req=Math.PI-target.omega*tTr;
  const phi_deg=(phi_req*180/Math.PI).toFixed(1);
  const tDays=(tTr*365.25).toFixed(1);
  // Cards for each computed launch window with its countdown.
  const wHTML=launchWindows.map((w,i)=>`
    <div class="wcard w${i+1}">
      <div class="wlbl">${w.label} · in ${fD(w.dt)} days</div>
      <div class="wval${i>0?` d${i+1}`:''}">${(w.dt*365.25).toFixed(1)} d</div>
    </div>`).join('');

  el.innerHTML=hopLogHTML()+`
    <div class="msec">
      <div class="msec-head"><span>Selected Orbits</span><span class="mh-tag">${asc?'↑ ASCENDING':'↓ DESCENDING'}</span></div>
      <div class="ocards">
        <div class="ocard src">
          <div class="ol">${hopMode?'Parked At':'Source'}</div>
          <div class="on" style="color:${source.color}">${source.name}</div>
          <div class="ov"><span style="color:${CC.r}">r₁</span> = ${f3(r1)} AU<br><span style="color:${CC.v}">v<sub>c1</sub></span> = ${fk(vc1)} km/s<br><span style="color:${CC.t}">T</span> = ${source.period.toFixed(3)} yr</div>
        </div>
        <div class="ocard tgt">
          <div class="ol">Target</div>
          <div class="on" style="color:${target.color}">${target.name}</div>
          <div class="ov"><span style="color:${CC.r}">r₂</span> = ${f3(r2)} AU<br><span style="color:${CC.v}">v<sub>c2</sub></span> = ${fk(vc2)} km/s<br><span style="color:${CC.t}">T</span> = ${target.period.toFixed(3)} yr</div>
        </div>
      </div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Launch Windows</span><span class="mh-tag">PHASE.ALIGN</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:7px;line-height:1.7">
        Required target lead angle: ${K(`\\textcolor{${CC.phi}}{\\varphi_{\\text{req}}} = ${phi_deg}^\\circ`)}
      </div>
      <div class="wcards">${wHTML}</div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Step by Step</span><span class="mh-tag">HOHMANN.CALC</span></div>
      <div class="step">
        <div class="snum">01</div>
        <div class="sbody"><b>Transfer semi-major axis</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.a}}{a_t}=\\tfrac{\\textcolor{${CC.r}}{${f3(r1)}}+\\textcolor{${CC.r}}{${f3(r2)}}}{2}=${f3(a_t)}\\;\\text{AU}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">02</div>
        <div class="sbody"><b>Ellipse geometry</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`c_t=${f3(c_t)},\\;b_t=${f3(b_t)},\\;e=${e_t.toFixed(4)}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">03</div>
        <div class="sbody"><b>Circular speeds</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.v}}{v_{c1}}=${fk(vc1)}\\;\\text{km/s},\\;\\textcolor{${CC.v}}{v_{c2}}=${fk(vc2)}\\;\\text{km/s}`)}</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">04</div>
        <div class="sbody"><b>Vis-viva at <span style="color:${CC.r}">r₁</span> on transfer</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.v}}{v_1}=\\sqrt{4\\pi^2\\!\\left(\\tfrac{2}{\\textcolor{${CC.r}}{${f3(r1)}}}-\\tfrac{1}{\\textcolor{${CC.a}}{${f3(a_t)}}}\\right)}`)}</div>
          <div class="sresult" style="color:${CC.v}">= ${fk(v1)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum">05</div>
        <div class="sbody"><b>Vis-viva at <span style="color:${CC.r}">r₂</span> on transfer</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.v}}{v_2}=\\sqrt{4\\pi^2\\!\\left(\\tfrac{2}{\\textcolor{${CC.r}}{${f3(r2)}}}-\\tfrac{1}{\\textcolor{${CC.a}}{${f3(a_t)}}}\\right)}`)}</div>
          <div class="sresult" style="color:${CC.v}">= ${fk(v2)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.dv}">06</div>
        <div class="sbody"><b style="color:${CC.dv}">First burn Δv₁</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.dv}}{\\Delta v_1}=|${fk(v1)}-${fk(vc1)}|`)}</div>
          <div class="sresult" style="color:${CC.dv}">= ${fk(dv1)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.t}">07</div>
        <div class="sbody"><b style="color:${CC.t}">Second burn Δv₂</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.t}}{\\Delta v_2}=|${fk(v2)}-${fk(vc2)}|`)}</div>
          <div class="sresult" style="color:${CC.t}">= ${fk(dv2)} km/s</div>
        </div>
      </div>
      <div class="step">
        <div class="snum" style="color:${CC.t}">08</div>
        <div class="sbody"><b style="color:${CC.t}">Transfer time</b>
          <div style="overflow-x:auto;margin:4px 0">${K(`\\textcolor{${CC.t}}{t_{tr}}=\\pi\\sqrt{\\textcolor{${CC.a}}{${f3(a_t)}}^3/4\\pi^2}`)}</div>
          <div class="sresult" style="color:${CC.t}">= ${tDays} days</div>
        </div>
      </div>
    </div>

    <div class="msec">
      <div class="msec-head"><span>Summary</span></div>
      <div class="scards">
        <div class="scard" style="border-left-color:${CC.dv}">
          <div class="sl">Δv₁ burn 1</div>
          <div class="sv" style="color:${CC.dv}">${fk(dv1)}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left-color:${CC.t}">
          <div class="sl">Δv₂ burn 2</div>
          <div class="sv" style="color:${CC.t}">${fk(dv2)}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left-color:${CC.r}">
          <div class="sl">Total Δv</div>
          <div class="sv" style="color:${CC.r}">${fk(dvTot)}<span class="su">km/s</span></div>
        </div>
        <div class="scard" style="border-left-color:${CC.v}">
          <div class="sl">Transfer time</div>
          <div class="sv" style="color:${CC.v}">${tDays}<span class="su">days</span></div>
        </div>
      </div>
    </div>`;
}

// HUD helpers: set the topbar status message.
function setStatus(m){document.getElementById('smsg').textContent=m}
// Enable or disable the Launch button.
function setBtnLaunch(v){document.getElementById('btnLaunch').disabled=!v}
// Switch the floating equation panel between LIVE and REFERENCE styling.
function setEqPanelActive(active){
  document.getElementById('eqPanel').classList.toggle('active',active);
  document.getElementById('eqState').textContent=active?'LIVE':'REFERENCE';
}
// Show or hide the transient banner over the canvas (green when a leg finishes).
function setTbar(show,msg='',green){
  const el=document.getElementById('tbar');
  if(show){
    el.textContent=msg;
    el.classList.add('show');
    el.classList.toggle('go',!!green);
  } else el.classList.remove('show');
}

/* INIT */
// Load the random system as the default and start the render loop.
loadPreset('random', document.querySelector('.pcard[data-preset="random"]'));
requestAnimationFrame(frame);
