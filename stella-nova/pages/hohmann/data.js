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

