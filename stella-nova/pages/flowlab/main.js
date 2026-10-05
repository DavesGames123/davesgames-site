// ============================================================================
//  FLOWLAB  ·  phase portraits and complex-function fields
// ----------------------------------------------------------------------------
//  A canvas-2D vector-field visualizer. Each named system supplies a plane
//  velocity field f(x,y) -> [u,v]. Thousands of tracer particles are advected
//  along that field and drawn as fading trails, painting the flow. A separate
//  RK4 integrator drives one "physical-model" state (the pendulum bob, the ball
//  in the well, and so on) shown both as a marker on the phase plane and in a
//  small inset. Two system families share the same machinery:
//    · flow   : field(x,y,P) is the phase-space velocity directly.
//    · complex: cf(x,y)=f(z); tracers follow the Polya field (Re f, -Im f).
//
//  COORDINATE FRAME   (world math units  <->  screen pixels)
//  --------------------------------------------------------------------------
//      world y up                     screen y down
//           ▲                              ┌──────────────▶ px
//           │            sx,sy             │
//     ──────●──────▶ x     ────▶           │      ● (CW/2,CH/2) = view center
//           │            wx,wy             │
//           │            ◀────             ▼ py
//      view.scale = pixels per world unit ; view.cx,cy = world point at center
//
//  PER-FRAME PIPELINE   (loop)
//  --------------------------------------------------------------------------
//      updateTracers(dt) ─ midpoint-step every tracer along fieldAt()
//      updatePS(dt) ───── RK4-step the one physical-model state
//              │
//              ▼
//      render():  clear ─▶ domain image ─▶ grid ─▶ arrows ─▶ tracers ─▶ marker
//      drawMSim(): pendulum | well | oscillator | populations | trajectory
//  The loop stops while the page is hidden (visibilitychange).
//
//  TRACER DRAW
//  --------------------------------------------------------------------------
//      Trails live in typed ring buffers (TRAIL_MAX slots for each tracer).
//      renderTracersGL() draws all trails in one instanced WebGL call on a
//      hidden canvas. The vertex shader does the palette, tone curve and hue.
//      render() adds that canvas with 'lighter'. drawTracers2D() is the
//      fallback when WebGL is not available.
//
//  TRACER LIFECYCLE
//  --------------------------------------------------------------------------
//      spawn ●─▶ advect (midpoint) ─▶ ring write ───▶ age++ ─┐
//              ▲                                               │
//              └──── respawn when slow / old / off-screen ◀────┘
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      color roles ......... "equation color roles"  old wrappers, sysRules map
//      systems ............. "const SYS="            all flows + complex maps
//      state ............... "const cfg="            live config + view + tracers
//      canvas / transforms . "function resize"       sizing and world<->screen
//      field accessor ...... "function fieldAt"      one field for both families
//      palettes / tone ..... "const PALETTES="       magnitude -> color ramp
//      domain coloring ..... "function buildDomain"  complex-plane hue image
//      streamer budget ..... "function tracerBudget" default count by area
//      tracers ............. "function spawnTracers" spawn + advect the trails
//      pole guard .......... "POLE GUARD"            arc-length cap, pole disks, level scale
//      tracer draw ......... "function renderTracersGL"  one instanced call
//      2D fallback ......... "function drawTracers2D"    per-segment strokes
//      hidden page ......... "visibilitychange"      stop / restart loop
//      physical integrator . "function rk4"          RK4 for the model state
//      main render ......... "function render"       grid, arrows, tracers, marker
//      mini model .......... "function drawMSim"     the inset physical model
//      equations ........... "function renderEquations"  MathJax SVG blocks
//      UI .................. "function selectSystem" panel + controls wiring
//      pan / zoom .......... "pan / zoom"            pointer, wheel, pinch
//      loop ................ "function loop"         rAF update + draw + status
//      screensaver ......... "window.snSaver"        shell saver hook
//      saver plate ......... "function saverPlate"   label plate: TeX, params, notes
// ============================================================================
"use strict";

/* ════════ equation color roles ════════ */
// The eqs strings below still wrap symbols in \textcolor{ST|PA|OP|FN}{...}.
// renderEquations() strips those wrappers (plainTeX) and colors the symbols
// with the lib/sci.css classes instead (sysRules): state x, theta, z m1,
// y m2, f and V m3, the first parameter m4, the second m5.
const ST="ST", PA="PA", OP="OP", FN="FN";

/* ════════ systems ════════
   flow:    field(x,y,P) -> [u,v]            (phase-space velocity)
   complex: cf(x,y) -> [u,v] = f(z);  tracers follow the Pólya field (u,-v)
   eqs():   array of {sub, tex}  typeset as MathJax SVG
   sim:     'pendulum' | 'well' | 'oscillator' | 'populations' | 'trajectory'
   view:    {cx,cy,span}  default framing in math units
   ic:      initial (x,y) for the physical-model integrator
*/
// Each entry is one selectable system. "flow" entries give the phase-space
// velocity directly in field(x,y,P); "complex" entries give f(z) in cf(x,y) and
// the tracers follow the Polya field. view sets default framing, ic is the
// physical-model start point, params declares the tunable sliders, eqs() returns
// equation blocks. positive:true confines the system to the first quadrant.
const SYS={
  // Damped pendulum. x=angle, y=angular velocity. -sin(x) is the restoring
  // torque; -z*y removes energy, so trajectories spiral into the rest state.
  pendulum:{name:"Damped pendulum",group:"flow",sim:"pendulum",positive:false,
    view:{cx:0,cy:0,span:4.6}, ic:[2.3,0],
    blurb:"θ vs angular velocity. The bob spirals into rest; the wavy separatrices split swinging from full rotation.",
    params:{z:{l:"damping ζ",min:0,max:1,step:0.01,d:0.25}},
    field:(x,y,P)=>[y,-Math.sin(x)-P.z*y],
    eqs:()=>[
      {sub:"Equation of motion (g/L = 1)",tex:`\\textcolor{${ST}}{\\ddot{\\theta}} + \\textcolor{${PA}}{\\zeta}\\,\\textcolor{${ST}}{\\dot{\\theta}} + \\sin\\textcolor{${ST}}{\\theta} = 0`},
      {sub:"Phase-space form · x=θ , y=ω",tex:`\\textcolor{${OP}}{\\dot{x}}=\\textcolor{${ST}}{y},\\qquad \\textcolor{${OP}}{\\dot{y}}=-\\sin\\textcolor{${ST}}{x}-\\textcolor{${PA}}{\\zeta}\\,\\textcolor{${ST}}{y}`}
    ]},
  // Van der Pol oscillator. The mu*(1-x^2)*y term pumps energy in when |x|<1
  // and drains it when |x|>1, so every start collapses onto one limit cycle.
  vdp:{name:"Van der Pol",group:"flow",sim:"oscillator",positive:false,
    view:{cx:0,cy:0,span:4.2}, ic:[0.1,0],
    blurb:"A self-sustaining nonlinear oscillator (from triode vacuum-tube circuits). Every trajectory is drawn onto one limit cycle.",
    params:{mu:{l:"μ",min:0.1,max:4,step:0.05,d:1.5}},
    field:(x,y,P)=>[y,P.mu*(1-x*x)*y-x],
    eqs:()=>[
      {sub:"Equation of motion",tex:`\\textcolor{${ST}}{\\ddot{x}} - \\textcolor{${PA}}{\\mu}\\,(1-\\textcolor{${ST}}{x}^2)\\,\\textcolor{${ST}}{\\dot{x}} + \\textcolor{${ST}}{x} = 0`},
      {sub:"Phase-space form · y=ẋ",tex:`\\textcolor{${OP}}{\\dot{x}}=\\textcolor{${ST}}{y},\\qquad \\textcolor{${OP}}{\\dot{y}}=\\textcolor{${PA}}{\\mu}(1-\\textcolor{${ST}}{x}^2)\\textcolor{${ST}}{y}-\\textcolor{${ST}}{x}`}
    ]},
  // Duffing double-well. Force x-x^3 is minus the derivative of the twin-well
  // potential V=-x^2/2+x^4/4, giving two spiral sinks around a central saddle.
  duffing:{name:"Duffing — double well",group:"flow",sim:"well",positive:false,
    view:{cx:0,cy:0,span:2.4}, ic:[1.7,0],
    blurb:"A particle in a twin-well potential. Two spiral sinks (well bottoms) separated by a saddle at the hilltop.",
    params:{z:{l:"damping ζ",min:0,max:0.6,step:0.01,d:0.14}},
    field:(x,y,P)=>[y,x-x*x*x-P.z*y],
    eqs:()=>[
      {sub:"Potential",tex:`\\textcolor{${FN}}{V(x)} = -\\tfrac{1}{2}\\textcolor{${ST}}{x}^2 + \\tfrac{1}{4}\\textcolor{${ST}}{x}^4`},
      {sub:"Equation of motion · F = −V′(x)",tex:`\\textcolor{${ST}}{\\ddot{x}} + \\textcolor{${PA}}{\\zeta}\\,\\textcolor{${ST}}{\\dot{x}} - \\textcolor{${ST}}{x} + \\textcolor{${ST}}{x}^3 = 0`}
    ]},
  // Lotka-Volterra predator-prey. Confined to positive populations; the shared
  // x*y coupling term makes closed orbits, so the two populations cycle forever.
  lotka:{name:"Predator–prey",group:"flow",sim:"populations",positive:true,
    view:{cx:1.25,cy:1.25,span:2.6}, ic:[1.0,0.45],
    blurb:"Lotka–Volterra. Closed orbits — prey and predator populations chase each other in a perpetual cycle.",
    params:{a:{l:"prey rate a",min:0.4,max:2,step:0.05,d:1.0},b:{l:"pred. rate b",min:0.4,max:2,step:0.05,d:1.0}},
    field:(x,y,P)=>[P.a*x-x*y,x*y-P.b*y],
    eqs:()=>[
      {sub:"Prey x · predator y",tex:`\\textcolor{${OP}}{\\dot{x}}=\\textcolor{${PA}}{a}\\,\\textcolor{${ST}}{x}-\\textcolor{${ST}}{x}\\textcolor{${ST}}{y}`},
      {sub:"",tex:`\\textcolor{${OP}}{\\dot{y}}=\\textcolor{${ST}}{x}\\textcolor{${ST}}{y}-\\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{y}`}
    ]},
  // Linear system with eigenvalues -c +/- i*w. The decay c sets the spiral:
  // c>0 stable inward, c=0 a pure center, c<0 unstable outward.
  spiral:{name:"Linear spiral",group:"flow",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:3.0}, ic:[1.5,0],
    blurb:"ż = (−c + iω) z. Sweep the decay c through zero: stable spiral → pure rotation (center) → unstable spiral.",
    params:{c:{l:"decay c",min:-0.6,max:0.6,step:0.02,d:0.22},w:{l:"rate ω",min:-2,max:2,step:0.05,d:1.0}},
    field:(x,y,P)=>[-P.c*x-P.w*y,P.w*x-P.c*y],
    eqs:()=>[
      {sub:"Linear system",tex:`\\textcolor{${OP}}{\\dot{\\mathbf{z}}} = \\begin{pmatrix} -\\textcolor{${PA}}{c} & -\\textcolor{${PA}}{\\omega} \\\\ \\textcolor{${PA}}{\\omega} & -\\textcolor{${PA}}{c}\\end{pmatrix}\\textcolor{${ST}}{\\mathbf{z}}`},
      {sub:"Eigenvalues",tex:`\\lambda = -\\textcolor{${PA}}{c} \\pm i\\,\\textcolor{${PA}}{\\omega}`}
    ]},
  // Saddle point: eigenvalues +a and -a. Flow grows along the x-axis and
  // decays along the y-axis, the canonical hyperbolic fixed point.
  saddle:{name:"Saddle",group:"flow",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:3.0}, ic:[0.12,1.3],
    blurb:"The canonical hyperbolic point: stable along one eigen-axis, unstable along the other.",
    params:{a:{l:"rate a",min:0.2,max:1.5,step:0.05,d:0.8}},
    field:(x,y,P)=>[P.a*x,-P.a*y],
    eqs:()=>[
      {sub:"Linear system",tex:`\\textcolor{${OP}}{\\dot{x}}=\\textcolor{${PA}}{a}\\,\\textcolor{${ST}}{x},\\qquad \\textcolor{${OP}}{\\dot{y}}=-\\textcolor{${PA}}{a}\\,\\textcolor{${ST}}{y}`},
      {sub:"Eigenvalues",tex:`\\lambda = \\pm\\textcolor{${PA}}{a}`}
    ]},

  // Complex maps below. cf returns [Re f, Im f] worked out by hand from z=x+iy.
  // z^2 = (x^2-y^2) + i(2xy); its double zero at 0 winds the phase twice.
  cz2:{name:"f(z) = z²",group:"complex",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:2.6}, ic:[1.1,0.6],
    blurb:"Argument winds twice around the origin — the hue cycles −π→π twice per loop. A double zero at 0.",
    cf:(x,y)=>[x*x-y*y,2*x*y],
    eqs:()=>[
      {sub:"Complex map",tex:`\\textcolor{${ST}}{f(z)} = \\textcolor{${ST}}{z}^{2}`},
      {sub:"Pólya field · domain hue",tex:`\\big(\\,\\mathrm{Re}\\,\\textcolor{${ST}}{f},\\, -\\mathrm{Im}\\,\\textcolor{${ST}}{f}\\,\\big),\\quad \\arg \\textcolor{${ST}}{f}\\in(-\\pi,\\pi]`}
    ]},
  // z^3 = (x^3-3xy^2) + i(3x^2y-y^3); triple zero winds the phase three times.
  cz3:{name:"f(z) = z³",group:"complex",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:2.4}, ic:[1.0,0.4],
    blurb:"A triple zero: the phase wheel spins three times around the origin.",
    cf:(x,y)=>[x*x*x-3*x*y*y,3*x*x*y-y*y*y],
    eqs:()=>[{sub:"Complex map",tex:`\\textcolor{${ST}}{f(z)} = \\textcolor{${ST}}{z}^{3}`},
      {sub:"Pólya field · domain hue",tex:`\\big(\\,\\mathrm{Re}\\,\\textcolor{${ST}}{f},\\, -\\mathrm{Im}\\,\\textcolor{${ST}}{f}\\,\\big),\\quad \\arg \\textcolor{${ST}}{f}\\in(-\\pi,\\pi]`}]},
  // 1/z = conj(z)/|z|^2 = (x - iy)/(x^2+y^2); the d||1e-9 guards the pole at 0.
  cinv:{name:"f(z) = 1/z",group:"complex",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:2.6}, ic:[1.2,0.5], poles:[[0,0]],
    blurb:"A simple pole. The phase winds the opposite way and the Pólya field streams inward.",
    cf:(x,y)=>{const d=x*x+y*y||1e-9;return[x/d,-y/d];},
    eqs:()=>[{sub:"Complex map",tex:`\\textcolor{${ST}}{f(z)} = \\dfrac{1}{\\textcolor{${ST}}{z}}`},
      {sub:"Pole at z = 0",tex:`\\arg \\textcolor{${ST}}{f} = -\\arg\\textcolor{${ST}}{z}\\in(-\\pi,\\pi]`}]},
  // Joukowski map z - 1/z with zeros at +/-1, the transform behind airfoil theory.
  cjou:{name:"f(z) = z − 1/z",group:"complex",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:2.8}, ic:[1.3,0.7], poles:[[0,0]],
    blurb:"Two simple zeros at ±1 — the Joukowski map behind classical airfoil theory.",
    cf:(x,y)=>{const d=x*x+y*y||1e-9;return[x-x/d,y+y/d];},
    eqs:()=>[{sub:"Complex map",tex:`\\textcolor{${ST}}{f(z)} = \\textcolor{${ST}}{z} - \\dfrac{1}{\\textcolor{${ST}}{z}}`},
      {sub:"Zeros at z = ±1",tex:`\\arg \\textcolor{${ST}}{f}\\in(-\\pi,\\pi]`}]},
  // sin z = sin x cosh y + i cos x sinh y; a row of simple zeros at z = n*pi.
  csin:{name:"f(z) = sin z",group:"complex",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:3.4}, ic:[0.8,0.6],
    blurb:"Periodic along the real axis — a row of simple zeros marching at z = nπ.",
    cf:(x,y)=>[Math.sin(x)*Math.cosh(y),Math.cos(x)*Math.sinh(y)],
    eqs:()=>[{sub:"Complex map",tex:`\\textcolor{${ST}}{f(z)} = \\sin \\textcolor{${ST}}{z}`},
      {sub:"Zeros at z = nπ",tex:`\\arg \\textcolor{${ST}}{f}\\in(-\\pi,\\pi]`}]},
  // Principal log: ln|z| + i*arg z. atan2 jumps across the negative real axis,
  // which shows up as the branch cut where the phase color tears.
  clog:{name:"f(z) = log z (branch)",group:"complex",sim:"trajectory",positive:false,
    view:{cx:0,cy:0,span:2.8}, ic:[1.0,0.8],
    blurb:"The principal branch. The phase tears along the negative real axis — that discontinuity is the branch cut.",
    cf:(x,y)=>[0.5*Math.log(x*x+y*y||1e-9),Math.atan2(y,x)],
    eqs:()=>[{sub:"Principal branch",tex:`\\textcolor{${ST}}{f(z)} = \\ln|\\textcolor{${ST}}{z}| + i\\,\\arg\\textcolor{${ST}}{z}`},
      {sub:"Branch cut on ℝ⁻",tex:`\\arg\\textcolor{${ST}}{z}\\in(-\\pi,\\pi]`}]}
};

/* ════════ state ════════ */
// cur = active system key; P = current parameter values for that system.
let cur="pendulum", P={};
let saverOn=false;   // set by snSaver.enter: tracers use stepAlong()
// cfg is the live control config: tracer count/speed/trail, color mode and
// palette, tone-curve knobs, and the display and playback toggles.
const cfg={den:2200,spd:14,trl:36,colMode:"speed",palette:"stella",gamma:1.0,contrast:1.0,exposure:1.0,dom:false,arr:false,axes:true,sim:true,playing:true};
// view maps world math units to screen: world point (cx,cy) sits at canvas
// center, scale is pixels per world unit.
const view={cx:0,cy:0,scale:90};
// The advected particle pool, as parallel typed arrays. Each tracer owns
// TRAIL_MAX ring slots for its trail, so a frame allocates nothing. trS is the
// speed level (0..1) and trH the phase hue (0..1) of each trail point. The
// pool is rebuilt on density change or system switch.
const TRAIL_MAX=80;                      // = max of the Trail slider
let TR_N=0;
let tX=new Float64Array(0), tY=new Float64Array(0);
let tAge=new Float32Array(0), tMax=new Float32Array(0);
let trX=new Float32Array(0), trY=new Float32Array(0);
let trS=new Float32Array(0), trH=new Float32Array(0);
let trHead=new Int32Array(0), trLen=new Int32Array(0);
// Offscreen domain-coloring image and its dirty flag; rebuilt lazily.
let domCache=null, domDirty=true;

/* physical-model integrator: ps = phase-space state driving the inset + main marker */
const ps={x:0,y:0,hist:[]};
const oscHist=[];          // displacement history for the oscillator sim

/* ════════ canvas ════════ */
// Main phase-portrait canvas plus the small physical-model inset canvas.
const canvas=document.getElementById("sim-canvas"), ctx=canvas.getContext("2d");
const msc=document.getElementById("msim-canvas"), mctx=msc.getContext("2d");
// CW/CH main CSS size, MW/MH inset size; DPR values cap device pixel ratio at 2.
let CW=0,CH=0,DPR=1, MW=236,MH=158,MDPR=1;

// Match both backing stores to their CSS size at the capped DPR, mark the
// domain image stale, and reframe the current system.
function resize(){
  const wrap=document.getElementById("canvas-wrap");
  CW=wrap.clientWidth||600; CH=wrap.clientHeight||400;
  DPR=Math.min(devicePixelRatio||1,2);
  canvas.width=CW*DPR; canvas.height=CH*DPR;
  glCanvas.width=canvas.width; glCanvas.height=canvas.height;
  msc.width=MW*MDPR; msc.height=MH*MDPR;
  MDPR=Math.min(devicePixelRatio||1,2);
  msc.width=MW*MDPR; msc.height=MH*MDPR;
  domDirty=true;
  frameSystem(true);
}
// Fit the system's view.span into the smaller canvas dimension. keepCenter
// preserves the current pan; otherwise recenter on the system's default.
function frameSystem(keepCenter){
  const v=SYS[cur].view;
  if(!keepCenter){view.cx=v.cx;view.cy=v.cy;}
  const fit=Math.min(CW,CH);
  view.scale=fit/(2*v.span);
}
// World -> screen (sx,sy) and screen -> world (wx,wy). y is flipped so world y
// points up while pixel y points down.
const sx=x=>CW/2+(x-view.cx)*view.scale;
const sy=y=>CH/2-(y-view.cy)*view.scale;
const wx=px=>view.cx+(px-CW/2)/view.scale;
const wy=py=>view.cy-(py-CH/2)/view.scale;

/* ════════ field accessor ════════ */
// One velocity source for both families. Flow systems return field() directly;
// complex systems return the Polya field (Re f, -Im f), whose streamlines are
// the level curves of the complex map.
function fieldAt(x,y){
  const S=SYS[cur];
  if(S.field) return S.field(x,y,P);
  const f=S.cf(x,y); return [f[0],-f[1]];     // Pólya
}

/* ════════ magnitude → color ramp (ported from MagnetLab / orbital viewer) ════════ */
// Each palette is a list of RGB stops (0..1) that ramp() interpolates between.
const PALETTES={
  stella:[[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]],
  plasma:[[0.05,0.03,0.53],[0.35,0,0.62],[0.61,0.09,0.62],[0.83,0.31,0.44],[0.96,0.58,0.25],[0.99,0.91,0.15]],
  viridis:[[0.27,0,0.33],[0.25,0.27,0.53],[0.18,0.43,0.56],[0.13,0.57,0.55],[0.21,0.72,0.47],[0.57,0.84,0.27],[0.99,0.91,0.14]],
  inferno:[[0,0,0.02],[0.22,0.04,0.33],[0.49,0.09,0.42],[0.74,0.21,0.33],[0.93,0.41,0.15],[0.99,0.71,0.18],[0.99,0.99,0.75]],
  ice:[[0,0.02,0.1],[0,0.18,0.45],[0,0.45,0.78],[0.25,0.74,0.96],[0.7,0.93,1],[1,1,1]],
  ember:[[0.02,0,0],[0.3,0.02,0],[0.66,0.11,0],[0.94,0.35,0],[1,0.7,0.15],[1,1,0.85]]
};
// Linearly interpolate the palette at position t in [0,1], returning [r,g,b].
function ramp(S,t){t=t<0?0:t>1?1:t;const n=S.length-1,v=t*n,i=Math.min(Math.floor(v),n-1),f=v-i;
  return[S[i][0]+f*(S[i+1][0]-S[i][0]),S[i][1]+f*(S[i+1][1]-S[i][1]),S[i][2]+f*(S[i+1][2]-S[i][2])];}
// Apply the tone curve: contrast pivots around 0.5, then gamma. Exposure is
// applied later at draw time, not here.
function toneMap(t){t=t<0?0:t>1?1:t;t=0.5+(t-0.5)*cfg.contrast;if(t<0)t=0;else if(t>1)t=1;t=Math.pow(t,1/cfg.gamma);return t<0?0:t>1?1:t;}
// Repaint the tone-curve preview: the palette strip along the bottom plus the
// response curve that gamma/contrast/exposure produce.
function drawToneCurve(){const cv=document.getElementById("toneCurve");if(!cv)return;const x=cv.getContext("2d"),W=cv.width,H=cv.height,gh=10,pad=3,S=PALETTES[cfg.palette]||PALETTES.stella;
  x.clearRect(0,0,W,H);x.fillStyle="#0c0f16";x.fillRect(0,0,W,H);
  for(let px=0;px<W;px++){const c=ramp(S,toneMap(px/(W-1)));x.fillStyle="rgb("+Math.min(255,c[0]*cfg.exposure*255|0)+","+Math.min(255,c[1]*cfg.exposure*255|0)+","+Math.min(255,c[2]*cfg.exposure*255|0)+")";x.fillRect(px,H-gh,1,gh);}
  x.strokeStyle="rgba(150,200,255,0.08)";x.lineWidth=1;for(let g=0;g<=4;g++){const gx=g/4*(W-1);x.beginPath();x.moveTo(gx,0);x.lineTo(gx,H-gh-1);x.stroke();}
  const ph=H-gh-2*pad;x.strokeStyle="#45d3ff";x.lineWidth=1.5;x.beginPath();
  for(let px=0;px<W;px++){let o=toneMap(px/(W-1))*cfg.exposure;o=o<0?0:o>1?1:o;const yy=pad+(1-o)*ph;px===0?x.moveTo(px,yy):x.lineTo(px,yy);}x.stroke();}
// Speed mode: compress field magnitude with log10 so a wide dynamic range fits
// 0..1, then look it up through the tone curve and palette.
function rampRGB(mag){const lc=speedLevel(mag);return ramp(PALETTES[cfg.palette]||PALETTES.stella,toneMap(lc));}
// Phase mode: HSL-style hue wheel (an inlined hue->rgb) at fixed saturation.
function hueRGB(h){h=((h%1)+1)%1;const a=0.85*Math.min(0.6,1-0.6);const f=n=>{const k=(n+h*12)%12;return 0.6-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1)));};return[f(0),f(8),f(4)];}

/* ════════ domain coloring (complex) ════════ */
// Paint the complex plane by the value of f(z): hue = arg f, lightness banded by
// log2|f| so magnitude contours read as brightness steps. Rendered once into an
// offscreen canvas (step=2 for speed) and cached until the view or system changes.
function buildDomain(){
  if(!cfg.dom||SYS[cur].group!=="complex"){domCache=null;domDirty=false;return;}
  const off=document.createElement("canvas"); off.width=CW; off.height=CH;
  const octx=off.getContext("2d"), img=octx.createImageData(CW,CH), D=img.data;
  const S=SYS[cur], step=2;
  // Walk the pixel grid in 2x2 blocks, evaluating f(z) at each block corner.
  for(let py=0;py<CH;py+=step){
    for(let px=0;px<CW;px+=step){
      const x=wx(px),y=wy(py),f=S.cf(x,y);
      // hue from the argument, mapped 0..1 over -pi..pi.
      const ang=Math.atan2(f[1],f[0]);
      const hue=(ang+Math.PI)/(2*Math.PI);
      // fractional part of log2|f| gives the repeating magnitude band.
      const mag=Math.hypot(f[0],f[1]);
      const band=mag>0?(Math.log2(mag)-Math.floor(Math.log2(mag))):0;
      const c=hslArr(hue,0.7,0.17+0.10*band);
      // Fill the whole block with the sampled color.
      for(let dy=0;dy<step&&py+dy<CH;dy++)for(let dx=0;dx<step&&px+dx<CW;dx++){
        const k=((py+dy)*CW+(px+dx))*4; D[k]=c[0];D[k+1]=c[1];D[k+2]=c[2];D[k+3]=255;
      }
    }
  }
  octx.putImageData(img,0,0); domCache=off; domDirty=false;
}
// HSL to 0..255 RGB (inlined, same hue math as hueRGB but scaled to bytes).
function hslArr(h,s,l){h=((h%1)+1)%1;const a=s*Math.min(l,1-l);const f=n=>{const k=(n+h*12)%12;return 255*(l-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1))));};return[f(0),f(8),f(4)];}

/* ════════ tracers ════════ */
// Streamer budget. The default count follows the canvas area, so a phone does
// not get the same pool as a desktop. The Density slider can still set any
// value up to 5000.
function tracerBudget(){
  const n=Math.round(CW*CH*0.0018/50)*50;
  return Math.max(600,Math.min(2200,n));
}
// Pick a random world position inside the visible box and write it to SPX/SPY.
// positive systems are confined to the first quadrant so tracers never seed on
// invalid populations.
let SPX=0, SPY=0;
function spawnPos(){
  const x0=wx(0),y0=wy(CH),x1=wx(CW),y1=wy(0);
  for(let k=0;k<8;k++){
    if(SYS[cur].positive){SPX=0.02+Math.random()*Math.max(0.1,x1-0.02);SPY=0.02+Math.random()*Math.max(0.1,y0-0.02);}
    else{SPX=x0+Math.random()*(x1-x0);SPY=y1+Math.random()*(y0-y1);}
    if(!nearPole(SPX,SPY,POLE_PX*2/view.scale))return;
  }
}
// Put tracer i at a fresh spawn with an empty trail and a random lifespan, so
// the pool does not respawn all on the same frame.
function respawnTracer(i){
  spawnPos(); tX[i]=SPX; tY[i]=SPY; tAge[i]=0; tMax[i]=2.5+Math.random()*3.5;
  trLen[i]=0; trHead[i]=0;
}
// Fill the pool with cfg.den tracers. The arrays grow only when the count
// is more than their size.
function spawnTracers(){
  const n=cfg.den;
  if(tX.length<n){
    tX=new Float64Array(n); tY=new Float64Array(n); tAge=new Float32Array(n); tMax=new Float32Array(n);
    trX=new Float32Array(n*TRAIL_MAX); trY=new Float32Array(n*TRAIL_MAX);
    trS=new Float32Array(n*TRAIL_MAX); trH=new Float32Array(n*TRAIL_MAX);
    trHead=new Int32Array(n); trLen=new Int32Array(n);
  }
  TR_N=n;
  for(let i=0;i<n;i++) respawnTracer(i);
}
/* ════════ POLE GUARD ════════ */
// A pole field (1/z, z - 1/z) has |v| -> infinity at the pole. A fixed
// time step then moves a tracer far past the pole in one jump, and the
// trails show straight lines across the center. Three guards stop this:
//   1. Arc-length cap. Each sub-step moves at most DS_PX screen px
//      (h = min(h, ds/|v|)). A frame takes at most SUB_MAX sub-steps, so
//      a tracer near a pole goes slower than the field, not farther.
//   2. Pole disk. A tracer inside POLE_PX of a pole in SYS[k].poles is
//      respawned. spawnPos() does not put a tracer inside 2 POLE_PX.
//   3. Level scale. The speed level is log(1 + m/mRef) / log(1 + mHi/mRef).
//      mRef and mHi are the median and the 98th percentile of |v| on a grid
//      over the view, out of the pole disks. Only the top 2 % of the view
//      gets the top palette color, so the center does not saturate.
// The shown equations do not change. Only the integration and the color do.
const DS_PX=3, SUB_MAX=10, POLE_PX=8;
function nearPole(x,y,r){
  const pl=SYS[cur].poles; if(!pl)return false;
  for(let k=0;k<pl.length;k++){const dx=x-pl[k][0],dy=y-pl[k][1];if(dx*dx+dy*dy<r*r)return true;}
  return false;
}
// The level scale, cached for one system, parameter set and view.
let lvKey="", lvRef=1/2.2, lvDen=1.5;
function updateLevelScale(){
  const key=saverOn+"|"+cur+"|"+view.cx+"|"+view.cy+"|"+view.scale+"|"+CW+"|"+CH+"|"+JSON.stringify(P);
  if(key===lvKey)return; lvKey=key;
  // the old curve: log10(1+2.2 m)/1.5. The saver uses the percentile scale
  // for every system, so the fast rows of sin z do not all go white.
  if(!SYS[cur].poles&&!saverOn){lvRef=1/2.2;lvDen=1.5;return;}
  const ms=[], rp=POLE_PX*2/view.scale;
  for(let j=0;j<20;j++)for(let i=0;i<32;i++){
    const x=wx((i+0.5)/32*CW), y=wy((j+0.5)/20*CH);
    if(nearPole(x,y,rp))continue;
    const f=fieldAt(x,y), m=Math.hypot(f[0],f[1]); if(isFinite(m))ms.push(m);
  }
  if(ms.length<16)return;
  ms.sort((a,b)=>a-b);
  const ref=Math.max(1e-6,ms[ms.length>>1]), hi=Math.max(ref*1.5,ms[Math.floor(ms.length*0.98)]);
  lvRef=ref; lvDen=Math.log10(1+hi/ref);
}
// SAVER STEP. In the saver a tracer moves along the unit direction of the
// field, not at the field speed. A streamline does not depend on the
// speed, so the curves stay the same. The screen speed stays in a band of
// 0.3 to 1 times SAVER_PX px/s, set by the speed level. Before, a field with no
// poles took one step per frame, capped at 0.7 CH px. In a 9:16 frame,
// sin z shows |y| up to 6, where |v| ~ cosh y is near 200, so a tracer
// jumped most of the canvas in one frame and its trail drew a straight
// streak. stepAlong() takes midpoint sub-steps of at most ds world units,
// at most SUB_MAX of them, and returns null on a non-finite or zero field.
// tests.mjs runs it on each saver system.
const SAVER_PX=360;
function stepAlong(x,y,dist,ds){
  for(let k=0;k<SUB_MAX&&dist>1e-12;k++){
    const h=Math.min(dist,ds); dist-=h;
    let f=fieldAt(x,y), m=Math.hypot(f[0],f[1]);
    if(!isFinite(m)||m<1e-9)return null;
    const mx=x+f[0]/m*h*0.5, my=y+f[1]/m*h*0.5;
    f=fieldAt(mx,my); m=Math.hypot(f[0],f[1]);
    if(!isFinite(m)||m<1e-9)return null;
    x+=f[0]/m*h; y+=f[1]/m*h;
  }
  return [x,y];
}
// The speed level in 0..1 for the trails, the arrows and rampRGB.
function speedLevel(m){const l=Math.log10(1+m/lvRef)/lvDen;return l<0?0:l>1?1:l;}

// Advance every tracer along the field with midpoint (RK2) sub-steps, write
// the new point into its trail ring, and respawn any tracer that has
// stalled, aged out, left the box or gone into a pole disk.
function updateTracers(dt){
  updateLevelScale();
  const positive=SYS[cur].positive, step=cfg.spd/10*0.016;
  // A field with no poles keeps one step per frame and the old cap of
  // 0.7 CH px per frame, so its tracers move as before.
  const pole=!!SYS[cur].poles, sub=pole?SUB_MAX:1;
  const ds=(pole?DS_PX:0.7*CH)/view.scale, rp=POLE_PX/view.scale;
  // Slightly enlarged bounds so trails can leave the frame before respawning.
  const x0=wx(0)-1,y0=wy(CH)-1,x1=wx(CW)+1,y1=wy(0)+1;
  const TWO_PI=2*Math.PI;
  for(let i=0;i<TR_N;i++){
    tAge[i]+=dt;
    let x=tX[i], y=tY[i];
    const f=fieldAt(x,y), fx=f[0], fy=f[1], m=Math.hypot(fx,fy);
    // Retire a tracer that is on a singularity, too slow, too old, or off-box.
    if(!isFinite(m)||m<1e-4||tAge[i]>tMax[i]||x<x0||x>x1||y<y0||y>y1||(positive&&(x<=0||y<=0))||nearPole(x,y,rp)){
      respawnTracer(i); continue;
    }
    if(saverOn){
      const q=stepAlong(x,y,SAVER_PX*cfg.spd/14*dt*(0.3+0.7*speedLevel(m))/view.scale,DS_PX/view.scale);
      if(!q){respawnTracer(i);continue;}
      x=q[0]; y=q[1];
    }
    // Sub-steps with an arc-length cap: h = min(h, ds/|v|) at each start
    // point, and the midpoint move is clamped to ds too.
    let rem=saverOn?0:step, gx=fx, gy=fy, gm=m;
    for(let k=0;k<sub&&rem>0;k++){
      const h=Math.min(rem, ds/gm); rem-=h;
      const f2=fieldAt(x+gx*h*0.5,y+gy*h*0.5), m2=Math.hypot(f2[0],f2[1]);
      if(!isFinite(m2)||m2<1e-12)break;
      const L=Math.min(m2*h,ds)/m2;
      x+=f2[0]*L; y+=f2[1]*L;
      if(rem<=0||k===sub-1)break;
      const g=fieldAt(x,y); gx=g[0]; gy=g[1]; gm=Math.hypot(gx,gy);
      if(!isFinite(gm)||gm<1e-12)break;
    }
    tX[i]=x; tY[i]=y;
    // Write [x, y, speed level, phase hue] to the next ring slot. The speed
    // level comes from speedLevel() here, so the draw does no log.
    const hd=trHead[i]+1===TRAIL_MAX?0:trHead[i]+1, o=i*TRAIL_MAX+hd;
    trX[o]=x; trY[o]=y; trS[o]=speedLevel(m); trH[o]=(Math.atan2(fy,fx)+Math.PI)/TWO_PI;
    trHead[i]=hd; if(trLen[i]<TRAIL_MAX)trLen[i]++;
  }
}

/* ════════ physical-model integrator ════════ */
// Classic 4th-order Runge-Kutta step of the same field, used for the one
// physical-model state so its orbit is accurate enough to close cleanly.
function rk4(s,h){
  const k1=fieldAt(s[0],s[1]);
  const k2=fieldAt(s[0]+h*0.5*k1[0],s[1]+h*0.5*k1[1]);
  const k3=fieldAt(s[0]+h*0.5*k2[0],s[1]+h*0.5*k2[1]);
  const k4=fieldAt(s[0]+h*k3[0],s[1]+h*k3[1]);
  return[s[0]+h/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),s[1]+h/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1])];
}
// Return the physical state to the system's initial condition and clear history.
function resetPS(){const ic=SYS[cur].ic;ps.x=ic[0];ps.y=ic[1];ps.hist=[];oscHist.length=0;}
// Advance the physical state by dt. Sub-steps (n=4) keep RK4 stable at stiff
// settings; the trailing history feeds the marker trail and the oscillator wave.
function updatePS(dt){
  const S=SYS[cur];
  const h=Math.min(dt,0.033)*1.0;
  // RK4 sub-steps with the same arc-length cap as the tracers (POLE GUARD):
  // no sub-step moves more than DS_PX screen px. Four sub-steps for a smooth
  // field, up to 64 near a pole. A field with no poles has no cap.
  const ds=SYS[cur].poles?DS_PX/view.scale:Infinity;
  let rem=h*1.4;
  for(let i=0;i<64&&rem>1e-9;i++){
    const f=fieldAt(ps.x,ps.y), m=Math.hypot(f[0],f[1]);
    const hh=Math.min(rem,h*1.4/4,isFinite(m)&&m>0?ds/m:rem); rem-=hh;
    const r=rk4([ps.x,ps.y],hh);ps.x=r[0];ps.y=r[1];
  }
  // reseed on divergence / escape (saddle, complex, etc.)
  // Escape radius depends on the system so bounded orbits are never reset early.
  const lim=S.group==="complex"?6:(S.sim==="trajectory"?7:1e4);
  if(!isFinite(ps.x)||!isFinite(ps.y)||Math.hypot(ps.x,ps.y)>lim||nearPole(ps.x,ps.y,POLE_PX/view.scale)||(S.positive&&(ps.x<=0.001||ps.y<=0.001))) resetPS();
  // Ring buffers: phase-plane trail (90 pts) and oscillator waveform (120 pts).
  ps.hist.push([ps.x,ps.y]); if(ps.hist.length>90)ps.hist.shift();
  oscHist.push(ps.x); if(oscHist.length>120)oscHist.shift();
}

/* ════════ render: main phase portrait ════════ */
// Compose the frame back-to-front: dark clear, optional domain image, grid,
// field arrows, tracer trails, then the physical-model marker on top.
function render(){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle="#0e1118"; ctx.fillRect(0,0,CW,CH);

  // Domain coloring backdrop for complex systems; rebuilt only when dirty.
  if(cfg.dom&&SYS[cur].group==="complex"){ if(domDirty)buildDomain(); if(domCache)ctx.drawImage(domCache,0,0,CW,CH); }

  if(cfg.axes) drawGrid();
  if(cfg.arr) drawArrows();
  drawTracers();
  if(cfg.sim) drawMarker();
}
// Faint world-aligned grid plus brighter axes. Grid spacing tightens to 0.5 for
// closely framed systems.
function drawGrid(){
  ctx.strokeStyle="rgba(150,200,255,0.05)"; ctx.lineWidth=1;
  const span=SYS[cur].view.span, gs=span<=2.6?0.5:1;
  const x0=wx(0),x1=wx(CW),y0=wy(CH),y1=wy(0);
  ctx.beginPath();
  for(let g=Math.ceil(x0/gs)*gs; g<x1; g+=gs){ctx.moveTo(sx(g),0);ctx.lineTo(sx(g),CH);}
  for(let g=Math.ceil(y0/gs)*gs; g<y1; g+=gs){ctx.moveTo(0,sy(g));ctx.lineTo(CW,sy(g));}
  ctx.stroke();
  ctx.strokeStyle="rgba(150,200,255,0.16)"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,sy(0));ctx.lineTo(CW,sy(0)); ctx.moveTo(sx(0),0);ctx.lineTo(sx(0),CH); ctx.stroke();
}
// Field arrows on a fixed 30px screen grid, colored and lengthened by the
// log-compressed magnitude. Additive blending makes overlaps glow.
function drawArrows(){
  ctx.save(); ctx.globalCompositeOperation="lighter";
  const step=30;
  // Sample the field at each grid node; skip near-zero cells to avoid noise.
  for(let px=step/2;px<CW;px+=step)for(let py=step/2;py<CH;py+=step){
    const f=fieldAt(wx(px),wy(py)); let m=Math.hypot(f[0],f[1]); if(m<1e-5)continue;
    let[r,g,b]=rampRGB(m);r*=cfg.exposure;g*=cfg.exposure;b*=cfg.exposure; const lv=speedLevel(m);
    const len=Math.max(3,lv*13), nx=f[0]/m, ny=-f[1]/m, a=Math.max(0.06,Math.min(0.5,lv*0.6));
    ctx.strokeStyle=`rgba(${r*0.4*255|0},${g*0.4*255|0},${b*0.4*255|0},${a})`; ctx.lineWidth=1.2;
    const ex=px+nx*len, ey=py+ny*len;
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(ex,ey);ctx.stroke();
    // Draw a small filled arrowhead at the tip for long-enough arrows.
    if(len>4){const ox=-ny*2.4,oy=nx*2.4;ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-nx*4+ox,ey-ny*4+oy);ctx.lineTo(ex-nx*4-ox,ey-ny*4-oy);ctx.closePath();ctx.fillStyle=ctx.strokeStyle;ctx.fill();}
  }
  ctx.restore();
}
/* ════════ tracer draw (WebGL, one instanced call) ════════ */
// All trails draw in one instanced call on a hidden WebGL canvas. Each instance
// is one segment A->B. It reads four slots P, A, B, N from one vertex buffer,
// [x, y, value, fade] per point. P and N are the neighbors, used for miter
// joins, so the quads of one trail share their joint edges: no gaps and no
// overlaps. The old round caps on every segment made beads. Slot 0 is a pad,
// so instance i starts at slot i. Each tracer uses trl+1 slots. The last slot
// has fade -1, so the segment into the next tracer collapses. On the newest
// point, value has +2 added. That flag gives the head a round cap.
//
// value is the speed level or the phase hue, as colMode selects. The vertex
// shader does the tone curve, the palette ramp, the hue wheel and exposure, so
// palette and tone changes apply at once to all trails. Color and fade
// interpolate along each quad, so the gradient along a trail is smooth.
//
// The fragment shader adds a wide dim glow and a thin bright core, the same
// widths and gains as the old two stroke passes: glow max(1,5f) at 0.12, core
// max(0.7,1.6f) at 1.0, in CSS px, where f is the fade.
const glCanvas=document.createElement("canvas");
let gl=null, glInst=null, glOK=false, glLoc=null, glVBuf=null;
let glData=new Float32Array(0), glView=null, glViewLen=-1;
const MAX_STOPS=8;
const TR_VS=`
attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aA; attribute vec4 aB; attribute vec4 aN;
uniform vec2 uRes; uniform vec3 uView; uniform float uDpr;
uniform float uMode; uniform vec3 uStops[${MAX_STOPS}]; uniform float uNS; uniform vec3 uTone;
varying float vDist; varying float vAlong; varying float vGlow; varying float vCore; varying float vFade; varying vec3 vCol;
vec2 toScreen(vec2 w){ return vec2(0.5*uRes.x+(w.x-uView.x)*uView.z, 0.5*uRes.y-(w.y-uView.y)*uView.z); }
vec2 dirOf(vec2 a,vec2 b,vec2 fb){ vec2 d=b-a; float l=length(d); return l>1e-5?d/l:fb; }
// Miter offset at a joint: the bisector of the two segment normals, scaled so
// the line keeps its width. The scale is clamped on sharp turns.
vec2 miter(vec2 n,vec2 dOther,bool has){
  if(!has) return n;
  vec2 m=normalize(n+vec2(-dOther.y,dOther.x)+1e-6);
  return m/max(dot(m,n),0.5);
}
// Palette ramp as a chain of mix() calls. Unused stops repeat the last stop.
vec3 ramp(float t){
  float s=clamp(t,0.0,1.0)*uNS; vec3 c=uStops[0];
  for(int k=1;k<${MAX_STOPS};k++) c=mix(c,uStops[k],clamp(s-float(k-1),0.0,1.0));
  return c;
}
// toneMap(): contrast about 0.5, then gamma. uTone = (contrast, gamma, exposure).
float tone(float t){ t=clamp(0.5+(clamp(t,0.0,1.0)-0.5)*uTone.x,0.0,1.0); return pow(t,1.0/uTone.y); }
// hueRGB(): the HSL hue wheel at s 0.85, l 0.6.
vec3 hue(float h){ vec3 k=mod(vec3(0.0,8.0,4.0)+fract(h)*12.0,12.0); return 0.6-0.34*clamp(min(k-3.0,9.0-k),-1.0,1.0); }
vec3 colorOf(float v){
  vec3 c=uMode<0.5?ramp(tone(v)):(uMode<1.5?hue(v):vec3(0.3,0.82,1.0));
  return min(c*uTone.z,vec3(1.0));
}
void main(){
  vDist=0.0; vAlong=0.0; vGlow=0.0; vCore=0.0; vFade=0.0; vCol=vec3(0.0);
  if(aA.w<0.0||aB.w<0.0){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
  vec2 sA=toScreen(aA.xy), sB=toScreen(aB.xy);
  vec2 d=sB-sA; float L=length(d);
  vec2 dir=L>1e-5?d/L:vec2(1.0,0.0);
  vec2 n=vec2(-dir.y,dir.x);
  // Joint normal at this end: A joins P->A, B joins B->N.
  bool atB=aCorner.x>0.5;
  vec2 j=atB?miter(n,dirOf(sB,toScreen(aN.xy),dir),aN.w>=0.0)
            :miter(n,dirOf(toScreen(aP.xy),sA,dir),aP.w>=0.0);
  float f=mix(aA.w,aB.w,aCorner.x);
  float glow=max(1.0,5.0*f)*uDpr, core=max(0.7,1.6*f)*uDpr;
  float halfExt=0.5*max(glow,1.0)+1.0;
  float vA=aA.z, cap=0.0;
  if(vA>=2.0){ vA-=2.0; cap=halfExt/uDpr; }
  float along=mix(-cap,L,aCorner.x);
  vec2 s=sA+dir*along+j*(aCorner.y*halfExt/uDpr);
  gl_Position=vec4(s.x/uRes.x*2.0-1.0,1.0-s.y/uRes.y*2.0,0.0,1.0);
  vDist=aCorner.y*halfExt; vAlong=along*uDpr; vGlow=glow; vCore=core; vFade=f;
  vCol=atB?colorOf(aB.z):colorOf(vA);
}`;
const TR_FS=`
precision mediump float;
varying float vDist; varying float vAlong; varying float vGlow; varying float vCore; varying float vFade; varying vec3 vCol;
float cov(float w,float d){ float we=max(w,1.0); return clamp(0.5*we+0.5-d,0.0,1.0)*(w/we); }
void main(){
  float dx=max(0.0,-vAlong);          // > 0 only inside the head cap
  float d=sqrt(dx*dx+vDist*vDist);
  vec3 c=vCol*(vFade*(0.12*cov(vGlow,d)+cov(vCore,d)));
  gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));
}`;

// Make the WebGL context, program and buffers. Returns false if WebGL or
// instancing is not available. Then drawTracers2D() draws the tracers.
function initTracerGL(){
  try{
    const o={alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false};
    gl=glCanvas.getContext("webgl2",o);
    if(gl){
      glInst={div:(l,d)=>gl.vertexAttribDivisor(l,d),draw:(m,f,c,n)=>gl.drawArraysInstanced(m,f,c,n)};
    }else{
      gl=glCanvas.getContext("webgl",o); if(!gl) return false;
      const e=gl.getExtension("ANGLE_instanced_arrays"); if(!e) return false;
      glInst={div:(l,d)=>e.vertexAttribDivisorANGLE(l,d),draw:(m,f,c,n)=>e.drawArraysInstancedANGLE(m,f,c,n)};
    }
    const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const p=gl.createProgram();
    gl.attachShader(p,sh(gl.VERTEX_SHADER,TR_VS)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,TR_FS));
    gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    const U=n=>gl.getUniformLocation(p,n);
    glLoc={corner:gl.getAttribLocation(p,"aCorner"),P:gl.getAttribLocation(p,"aP"),A:gl.getAttribLocation(p,"aA"),
      B:gl.getAttribLocation(p,"aB"),N:gl.getAttribLocation(p,"aN"),
      res:U("uRes"),view:U("uView"),dpr:U("uDpr"),mode:U("uMode"),stops:U("uStops"),ns:U("uNS"),tone:U("uTone")};
    // Static quad corners: x = 0 at A and 1 at B, y = -1 or +1 across the line.
    const cb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,cb);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,-1,1,-1,0,1,1,1]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(glLoc.corner);
    gl.vertexAttribPointer(glLoc.corner,2,gl.FLOAT,false,0,0); glInst.div(glLoc.corner,0);
    glVBuf=gl.createBuffer();
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE); // additive, as the old 'lighter' strokes
    glCanvas.addEventListener("webglcontextlost",e=>{e.preventDefault();glOK=false;});
    return true;
  }catch(err){ console.warn("flowlab: WebGL tracers off, 2D fallback.",err); return false; }
}
glOK=initTracerGL();
// The tab shell removes the iframe on a page swap. Release the context then.
window.addEventListener("pagehide",function(){try{if(gl)gl.getExtension("WEBGL_lose_context").loseContext();}catch(e){}});

// Fill the vertex buffer: one -1 pad slot, then per tracer the newest trl
// points of its ring, newest first, then one -1 slot, then a final -1 pad
// slot. Fade is (1 - s/trl) * ageA, as before. Returns the slot count
// without the two pads.
function fillTracerVerts(){
  const TL=Math.min(cfg.trl,TRAIL_MAX), stride=TL+1, need=(TR_N*stride+2)*4;
  if(glData.length<need) glData=new Float32Array((TR_N*(TRAIL_MAX+1)+2)*4);
  const V=cfg.colMode==="speed"?trS:cfg.colMode==="phase"?trH:null;
  glData[3]=-1;
  let w=4;
  for(let i=0;i<TR_N;i++){
    // Age envelope: fade in on spawn, fade out over the last 20 % of life.
    const age=tAge[i], mx=tMax[i];
    const ageA=age<0.1?age/0.1:age>mx*0.8?Math.max(0,(mx-age)/(mx*0.2)):1;
    const L=trLen[i]<TL?trLen[i]:TL, base=i*TRAIL_MAX;
    let h=trHead[i];
    for(let s=0;s<L;s++){
      const o=base+h, v=V?V[o]:0;
      glData[w]=trX[o]; glData[w+1]=trY[o]; glData[w+2]=s===0?v+2:v; // +2 = head
      glData[w+3]=(1-s/TL)*ageA; w+=4;
      h=h===0?TRAIL_MAX-1:h-1;
    }
    for(let s=L;s<stride;s++){ glData[w+3]=-1; w+=4; }
  }
  glData[w+3]=-1;
  return TR_N*stride;
}

// Draw the tracers into glCanvas. Returns false if WebGL is not in use.
const _stops=new Float32Array(MAX_STOPS*3);
function renderTracersGL(){
  if(!glOK) return false;
  gl.viewport(0,0,glCanvas.width,glCanvas.height);
  gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  const slots=fillTracerVerts();
  if(slots<2) return true;
  const len=(slots+2)*4;
  if(len!==glViewLen){ glView=glData.subarray(0,len); glViewLen=len; }
  gl.bindBuffer(gl.ARRAY_BUFFER,glVBuf);
  gl.bufferData(gl.ARRAY_BUFFER,glView,gl.DYNAMIC_DRAW);
  // Instance i reads slots i..i+3 as P, A, B, N.
  const at=[glLoc.P,glLoc.A,glLoc.B,glLoc.N];
  for(let k=0;k<4;k++){ gl.enableVertexAttribArray(at[k]); gl.vertexAttribPointer(at[k],4,gl.FLOAT,false,16,16*k); glInst.div(at[k],1); }
  const S=PALETTES[cfg.palette]||PALETTES.stella;
  for(let k=0;k<MAX_STOPS;k++){const c=S[Math.min(k,S.length-1)];_stops[k*3]=c[0];_stops[k*3+1]=c[1];_stops[k*3+2]=c[2];}
  gl.uniform3fv(glLoc.stops,_stops); gl.uniform1f(glLoc.ns,S.length-1);
  gl.uniform1f(glLoc.mode,cfg.colMode==="speed"?0:cfg.colMode==="phase"?1:2);
  gl.uniform3f(glLoc.tone,cfg.contrast,cfg.gamma,cfg.exposure);
  gl.uniform2f(glLoc.res,CW,CH); gl.uniform3f(glLoc.view,view.cx,view.cy,view.scale);
  gl.uniform1f(glLoc.dpr,glCanvas.width/CW);
  glInst.draw(gl.TRIANGLE_STRIP,0,4,slots-1);
  return true;
}

// Tracer layer entry point, called from render(). With WebGL, add glCanvas to
// the 2D canvas in device space. Without WebGL, use the 2D path.
function drawTracers(){
  if(renderTracersGL()){
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalCompositeOperation="lighter";
    ctx.drawImage(glCanvas,0,0); ctx.restore();
    return;
  }
  drawTracers2D();
}
// 2D fallback: the old per-segment strokes, a soft wide halo then a bright
// core, read from the same vertex buffer. It is slow, but it runs only when
// WebGL is not available.
function drawTracers2D(){
  ctx.save(); ctx.globalCompositeOperation="lighter"; ctx.lineCap="round"; const EX=cfg.exposure;
  const slots=fillTracerVerts(), d=glData;
  for(let i=1;i<slots;i++){
    const o=i*4, a0=d[o+3];
    if(a0<0.01||d[o+7]<0) continue;
    const v=d[o+2]>=2?d[o+2]-2:d[o+2];
    let r,g,b;
    if(cfg.colMode==="speed"){[r,g,b]=ramp(PALETTES[cfg.palette]||PALETTES.stella,toneMap(v));}
    else if(cfg.colMode==="phase"){[r,g,b]=hueRGB(v);}
    else {r=0.3;g=0.82;b=1.0;}
    r*=EX;g*=EX;b*=EX;
    const x0=sx(d[o]),y0=sy(d[o+1]),x1=sx(d[o+4]),y1=sy(d[o+5]);
    ctx.strokeStyle=`rgba(${r*a0*0.12*255|0},${g*a0*0.12*255|0},${b*a0*0.12*255|0},1)`; ctx.lineWidth=Math.max(1,5*a0);
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    ctx.strokeStyle=`rgba(${r*255|0},${g*255|0},${b*255|0},${a0})`; ctx.lineWidth=Math.max(0.7,1.6*a0);
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
  }
  ctx.restore();
}
// Draw the physical-model state on the phase plane: its recent path, a crosshair,
// and a glowing dot at the current (x,y).
function drawMarker(){
  // trail of the physical-model state across the phase plane
  ctx.save(); ctx.globalCompositeOperation="lighter";
  ctx.strokeStyle="rgba(255,255,255,0.5)"; ctx.lineWidth=1.4; ctx.beginPath();
  for(let i=0;i<ps.hist.length;i++){const X=sx(ps.hist[i][0]),Y=sy(ps.hist[i][1]);i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);}
  ctx.stroke(); ctx.restore();
  const X=sx(ps.x),Y=sy(ps.y);
  ctx.strokeStyle="rgba(255,200,80,0.6)"; ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(X-9,Y);ctx.lineTo(X+9,Y);ctx.moveTo(X,Y-9);ctx.lineTo(X,Y+9);ctx.stroke();
  ctx.fillStyle="#fff"; ctx.shadowColor="#ffc832"; ctx.shadowBlur=10;
  ctx.beginPath();ctx.arc(X,Y,3.4,0,7);ctx.fill(); ctx.shadowBlur=0;
}

/* ════════ render: mini physical model ════════ */
// Dispatch the inset to the drawing that matches the system's sim type, fed the
// current physical state (x,y). The inset makes the abstract phase point
// concrete: an angle, a ball in a well, a mass on a track, population bars.
function drawMSim(){
  mctx.setTransform(MDPR,0,0,MDPR,0,0);
  mctx.clearRect(0,0,MW,MH);
  const S=SYS[cur], X=ps.x, Y=ps.y;
  if(S.sim==="pendulum") drawPendulum(X,Y);
  else if(S.sim==="well") drawWell(X,Y);
  else if(S.sim==="oscillator") drawOscillator(X,Y);
  else if(S.sim==="populations") drawPopulations(X,Y);
  else drawTrajectory(X,Y);
}
// Small text helper for inset labels.
function txt(s,x,y,col,size,align){mctx.fillStyle=col;mctx.font=(size||9)+"px Inter,system-ui,sans-serif";mctx.textAlign=align||"left";mctx.textBaseline="middle";mctx.fillText(s,x,y);}
// Pendulum inset: bob hangs at angle th from vertical, with an angle arc, a
// tangential omega arrow, and a gravity marker.
function drawPendulum(th,om){
  const px=MW/2, py=MH*0.30, L=MH*0.42;
  mctx.strokeStyle="rgba(150,200,255,0.25)";mctx.lineWidth=1;mctx.beginPath();mctx.moveTo(px-34,py);mctx.lineTo(px+34,py);mctx.stroke();
  const bx=px+Math.sin(th)*L, by=py+Math.cos(th)*L;
  // angle arc from downward vertical
  mctx.strokeStyle="rgba(255,200,80,0.45)";mctx.lineWidth=1;mctx.beginPath();mctx.arc(px,py,20,Math.PI/2,Math.PI/2+th,th<0);mctx.stroke();
  txt("θ",px+ (th>0?16:-20),py+22,"#ffc832",9,"center");
  // rod + bob
  mctx.strokeStyle="#45d3ff";mctx.lineWidth=2;mctx.beginPath();mctx.moveTo(px,py);mctx.lineTo(bx,by);mctx.stroke();
  mctx.fillStyle="#5a8cc0";mctx.beginPath();mctx.arc(px,py,2.5,0,7);mctx.fill();
  mctx.fillStyle="#cfeaff";mctx.shadowColor="#45d3ff";mctx.shadowBlur=10;mctx.beginPath();mctx.arc(bx,by,7,0,7);mctx.fill();mctx.shadowBlur=0;
  // ω arrow (tangential)
  const tnx=Math.cos(th), tny=-Math.sin(th), ow=Math.max(-1,Math.min(1,om/3));
  mctx.strokeStyle="rgba(100,200,100,0.8)";mctx.lineWidth=1.6;mctx.beginPath();mctx.moveTo(bx,by);mctx.lineTo(bx+tnx*18*ow,by+tny*18*ow);mctx.stroke();
  txt("ω",bx+tnx*20*ow,by+tny*20*ow,"#64c864",9,"center");
  // gravity
  mctx.strokeStyle="rgba(150,160,180,0.5)";mctx.lineWidth=1;mctx.beginPath();mctx.moveTo(MW-16,MH-30);mctx.lineTo(MW-16,MH-14);mctx.stroke();mctx.beginPath();mctx.moveTo(MW-19,MH-19);mctx.lineTo(MW-16,MH-14);mctx.lineTo(MW-13,MH-19);mctx.stroke();
  txt("g",MW-16,MH-36,"#8090b0",8,"center");
}
// Double-well inset: draw the potential curve V(x)=-x^2/2+x^4/4, mark the two
// well bottoms, and place the ball at the current x with a velocity arrow.
function drawWell(x,v){
  const V=t=>-0.5*t*t+0.25*t*t*t*t;
  const xr=1.9, x2s=t=>MW/2+t/xr*(MW/2-16);
  // potential curve (V mapped: min V at ±1 is -0.25, max at 0 is 0)
  let minV=-0.30,maxV=0.45; const y2s=val=>MH*0.30+ (val-minV)/(maxV-minV)*(MH*0.55);
  mctx.strokeStyle="rgba(150,200,255,0.4)";mctx.lineWidth=1.6;mctx.beginPath();
  for(let i=0;i<=80;i++){const t=-xr+2*xr*i/80;const X=x2s(t),Yp=MH-y2s(V(t));i?mctx.lineTo(X,Yp):mctx.moveTo(X,Yp);}mctx.stroke();
  // wells
  txt("V(x)",14,16,"#c890ff",9,"left");
  [-1,1].forEach(w=>{const X=x2s(w);mctx.fillStyle="rgba(150,200,255,0.3)";mctx.beginPath();mctx.arc(X,MH-y2s(V(w)),2,0,7);mctx.fill();});
  // ball
  const bx=x2s(Math.max(-xr,Math.min(xr,x))), by=MH-y2s(V(Math.max(-xr,Math.min(xr,x))));
  mctx.fillStyle="#cfeaff";mctx.shadowColor="#45d3ff";mctx.shadowBlur=10;mctx.beginPath();mctx.arc(bx,by-4,5.5,0,7);mctx.fill();mctx.shadowBlur=0;
  const vv=Math.max(-1,Math.min(1,v/2.2));
  mctx.strokeStyle="rgba(100,200,100,0.8)";mctx.lineWidth=1.6;mctx.beginPath();mctx.moveTo(bx,by-4);mctx.lineTo(bx+vv*18,by-4);mctx.stroke();
  txt("x",bx,MH-10,"#45d3ff",9,"center");
}
// Oscillator inset: a node sliding on a track at displacement x with a velocity
// arrow, plus a scrolling waveform of x(t) built from oscHist.
function drawOscillator(x,v){
  const cx=MW*0.5, midY=MH*0.42, sc=(MW*0.5-26)/2.4;
  // track
  mctx.strokeStyle="rgba(150,200,255,0.2)";mctx.lineWidth=1;mctx.beginPath();mctx.moveTo(20,midY);mctx.lineTo(MW-20,midY);mctx.stroke();
  mctx.strokeStyle="rgba(150,200,255,0.35)";mctx.beginPath();mctx.moveTo(cx,midY-7);mctx.lineTo(cx,midY+7);mctx.stroke();
  // node
  const nx=cx+Math.max(-2.4,Math.min(2.4,x))*sc;
  mctx.fillStyle="#cfeaff";mctx.shadowColor="#45d3ff";mctx.shadowBlur=12;mctx.beginPath();mctx.arc(nx,midY,7,0,7);mctx.fill();mctx.shadowBlur=0;
  const vv=Math.max(-1,Math.min(1,v/3));
  mctx.strokeStyle="rgba(100,200,100,0.8)";mctx.lineWidth=1.6;mctx.beginPath();mctx.moveTo(nx,midY);mctx.lineTo(nx+vv*18,midY);mctx.stroke();
  txt("x",nx,midY-13,"#45d3ff",9,"center"); txt("ẋ",nx+vv*20,midY,"#64c864",9,"center");
  // scrolling waveform of x(t)
  const wy0=MH*0.78, wamp=MH*0.16;
  mctx.strokeStyle="rgba(69,211,255,0.6)";mctx.lineWidth=1.2;mctx.beginPath();
  const n=oscHist.length;
  for(let i=0;i<n;i++){const X=20+(MW-40)*i/Math.max(1,119);const Y=wy0-Math.max(-2.4,Math.min(2.4,oscHist[i]))/2.4*wamp;i?mctx.lineTo(X,Y):mctx.moveTo(X,Y);}mctx.stroke();
  txt("x(t)",22,wy0-wamp-4,"#5a8cc0",8,"left");
}
// Predator-prey inset: two bars for the current prey and predator counts, plus
// history curves of both drawn from ps.hist.
function drawPopulations(prey,pred){
  const baseY=MH-22, h=MH*0.5, sc=h/2.6;
  const bx1=MW*0.30, bx2=MW*0.62, bw=26;
  mctx.fillStyle="rgba(100,200,100,0.8)";const h1=Math.max(1,Math.min(2.6,prey)*sc);mctx.fillRect(bx1-bw/2,baseY-h1,bw,h1);
  mctx.fillStyle="rgba(255,140,90,0.85)";const h2=Math.max(1,Math.min(2.6,pred)*sc);mctx.fillRect(bx2-bw/2,baseY-h2,bw,h2);
  mctx.strokeStyle="rgba(150,200,255,0.2)";mctx.lineWidth=1;mctx.beginPath();mctx.moveTo(16,baseY);mctx.lineTo(MW-16,baseY);mctx.stroke();
  txt("prey x",bx1,baseY+11,"#64c864",8,"center"); txt("pred. y",bx2,baseY+11,"#ff8c5a",8,"center");
  // history curves
  mctx.strokeStyle="rgba(100,200,100,0.55)";mctx.lineWidth=1;mctx.beginPath();
  for(let i=0;i<ps.hist.length;i++){const X=14+(MW-28)*i/89;const Y=MH*0.30-Math.min(2.6,ps.hist[i][0])/2.6*MH*0.18+MH*0.0;i?mctx.lineTo(X,Y):mctx.moveTo(X,Y);}mctx.stroke();
  mctx.strokeStyle="rgba(255,140,90,0.55)";mctx.beginPath();
  for(let i=0;i<ps.hist.length;i++){const X=14+(MW-28)*i/89;const Y=MH*0.30-Math.min(2.6,ps.hist[i][1])/2.6*MH*0.18+MH*0.0;i?mctx.lineTo(X,Y):mctx.moveTo(X,Y);}mctx.stroke();
}
// Generic inset for trajectory/complex systems: a miniature phase box with a
// faint field, the integrated orbit, and a dot at the current point.
function drawTrajectory(x,y){
  // mini phase box: faint field + integrated orbit + moving dot
  const span=SYS[cur].view.span, msx=v=>MW/2+v/span*(MW/2-12), msy=v=>MH/2-v/span*(MH/2-12);
  mctx.strokeStyle="rgba(150,200,255,0.06)";mctx.lineWidth=1;mctx.beginPath();mctx.moveTo(0,MH/2);mctx.lineTo(MW,MH/2);mctx.moveTo(MW/2,0);mctx.lineTo(MW/2,MH);mctx.stroke();
  mctx.save();mctx.globalCompositeOperation="lighter";
  const st=26;
  for(let X=st/2;X<MW;X+=st)for(let Y=st/2;Y<MH;Y+=st){
    const wxv=(X-MW/2)/(MW/2-12)*span, wyv=-(Y-MH/2)/(MH/2-12)*span;
    const f=fieldAt(wxv,wyv);let m=Math.hypot(f[0],f[1]);if(m<1e-5)continue;
    const nx=f[0]/m,ny=-f[1]/m,len=8;
    mctx.strokeStyle="rgba(90,140,192,0.4)";mctx.lineWidth=1;mctx.beginPath();mctx.moveTo(X,Y);mctx.lineTo(X+nx*len,Y+ny*len);mctx.stroke();
  }
  mctx.restore();
  mctx.strokeStyle="rgba(255,255,255,0.55)";mctx.lineWidth=1.3;mctx.beginPath();
  for(let i=0;i<ps.hist.length;i++){const X=msx(ps.hist[i][0]),Y=msy(ps.hist[i][1]);i?mctx.lineTo(X,Y):mctx.moveTo(X,Y);}mctx.stroke();
  mctx.fillStyle="#cfeaff";mctx.shadowColor="#45d3ff";mctx.shadowBlur=9;mctx.beginPath();mctx.arc(msx(x),msy(y),4,0,7);mctx.fill();mctx.shadowBlur=0;
  txt("(x, y)",10,12,"#45d3ff",9,"left");
}

/* ════════ var caption ════════ */
// Build the inset's variable readout markup for the current system. The pendulum
// wraps its angle into (-pi, pi] before display.
function varCaption(){
  const S=SYS[cur], X=ps.x, Y=ps.y;
  const f=(v)=>v.toFixed(2);
  if(S.sim==="pendulum")return `<span class="vk">θ</span> <b>${f(((ps.x+Math.PI)%(2*Math.PI)-Math.PI))}</b> rad &nbsp; <span class="vk">ω</span> <b>${f(Y)}</b> &nbsp; <span class="vp">ζ</span> <b>${f(P.z)}</b>`;
  if(S.sim==="oscillator")return `<span class="vk">x</span> <b>${f(X)}</b> &nbsp; <span class="vk">ẋ</span> <b>${f(Y)}</b> &nbsp; <span class="vp">μ</span> <b>${f(P.mu)}</b>`;
  if(S.sim==="well")return `<span class="vk">x</span> <b>${f(X)}</b> &nbsp; <span class="vk">ẋ</span> <b>${f(Y)}</b> &nbsp; <span class="vp">ζ</span> <b>${f(P.z)}</b>`;
  if(S.sim==="populations")return `<span class="vk">prey x</span> <b>${f(X)}</b> &nbsp; <span class="vk">pred y</span> <b>${f(Y)}</b>`;
  return `<span class="vk">x</span> <b>${f(X)}</b> &nbsp; <span class="vk">y</span> <b>${f(Y)}</b>`;
}

/* ════════ equations ════════ */
// lib/sci-math.js is an ES module; this classic script loads it with a
// dynamic import(). It typesets TeX as MathJax SVG. If MathJax does not load,
// the TeX text stays in the box with the class "raw".
const SCI=import("../../lib/sci-math.js").catch(err=>{console.error("[math]",err);return null;});
// Replace each \textcolor{color}{body} wrapper with {body}. The braces keep
// a control word apart from the body (sin{x}, not sinx).
function plainTeX(tex){let out="",i=0;const K="\\textcolor{";
  while(i<tex.length){const j=tex.indexOf(K,i);if(j<0){out+=tex.slice(i);break;}
    out+=tex.slice(i,j);const k=tex.indexOf("}",j+K.length)+1;   // skip the color group
    let d=0,e=k;for(;e<tex.length;e++){if(tex[e]==="{")d++;else if(tex[e]==="}"&&--d===0)break;}
    out+="{"+tex.slice(k+1,e)+"}";i=e+1;}
  return out;}
// A parameter label is "word symbol" ("damping ζ") or a symbol ("μ"). The
// symbol is the last word. paramSym gives its TeX, paramWord the rest.
const GREEK={"ζ":"\\zeta","μ":"\\mu","ω":"\\omega","θ":"\\theta"};
const paramSym=l=>{const t=l.trim().split(/\s+/).pop();return GREEK[t]||t;};
const paramWord=l=>{const w=l.trim().split(/\s+/);w.pop();return w.join(" ");};
// Color rules of the current system: x, theta, z m1, y m2, f, V m3, then the
// first two parameters m4 and m5.
function sysRules(){const r=[["x","m1"],["\\theta","m1"],["z","m1"],["\\mathbf{z}","m1"],["y","m2"],["f","m3"],["V","m3"]];
  Object.values(SYS[cur].params||{}).slice(0,2).forEach((d,i)=>r.push([paramSym(d.l),"m"+(4+i)]));return r;}
// Typeset the current system's equation blocks into the panel as MathJax
// SVG, in sysRules colors.
function renderEquations(){
  const wrap=document.getElementById("eq-blocks"); wrap.innerHTML="";
  const blocks=SYS[cur].eqs(), rules=sysRules();
  blocks.forEach(b=>{
    const div=document.createElement("div"); div.className="eq-block";
    div.innerHTML=(b.sub?`<div class="eq-sublabel">${b.sub}</div>`:"")+`<div class="eq-row sci-eq"></div>`;
    wrap.appendChild(div);
    const el=div.querySelector(".eq-row"), t=plainTeX(b.tex); el.dataset.tex=t;
    SCI.then(m=>m?m.typeset(el,t,{rules}):(el.textContent=t,el.classList.add("raw")));
  });
}

/* ════════ UI ════════ */
// Short id lookup helper.
const $=id=>document.getElementById(id);
// Set the --pct custom property a slider's CSS fill reads from its value.
function setRange(r){const pct=(r.value-r.min)/(r.max-r.min)*100;r.style.setProperty("--pct",pct+"%");}
// Reset P to the current system's default parameter values.
function loadParams(){P={};const ps2=SYS[cur].params;if(ps2)for(const k in ps2)P[k]=ps2[k].d;}
// Build a slider row per declared parameter and wire it to P; editing marks the
// domain image dirty and re-renders the equations.
function buildParamUI(){
  const wrap=$("params"); wrap.innerHTML=""; const ps2=SYS[cur].params; if(!ps2)return;
  for(const k in ps2){
    const d=ps2[k], row=document.createElement("div"); row.className="mrow";
    const word=paramWord(d.l);
    row.innerHTML=`<span class="mrow-lbl"><span class="sci-sym"></span>${word?` <span class="w">${word}</span>`:""}</span><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${P[k]}"><span class="val">${P[k].toFixed(2)}</span>`;
    wrap.appendChild(row);
    const sym=row.querySelector(".sci-sym"), t=paramSym(d.l); sym.dataset.tex=t; sym.dataset.inline="";
    SCI.then(m=>m?m.typeset(sym,t,{display:false,rules:sysRules()}):(sym.textContent=d.l));
    const r=row.querySelector("input"); setRange(r);
    // The equations hold no parameter values, so a slider move does not
    // typeset them again.
    r.addEventListener("input",()=>{P[k]=parseFloat(r.value);row.querySelector(".val").textContent=P[k].toFixed(2);setRange(r);domDirty=true;});
  }
}
// Switch to a system: load its params and UI, equations, blurb, and labels,
// then reframe, reset the physical model, and respawn the tracer pool.
function selectSystem(key){
  cur=key; loadParams(); buildParamUI(); renderEquations();
  $("sysBlurb").innerHTML=`<b>${SYS[cur].name}.</b> ${SYS[cur].blurb}`;
  $("msim-title").textContent = SYS[cur].sim==="trajectory" ? "Test trajectory" : "Physical model";
  $("st-sys").textContent=SYS[cur].name;
  domDirty=true; frameSystem(false); resetPS(); spawnTracers();
}

// dropdown
// Populate the system dropdown, splitting flows and complex maps into two
// optgroups, then switch systems on change.
const sel=$("sysSel");
const gF=document.createElement("optgroup"); gF.label="Flows · phase portraits";
const gC=document.createElement("optgroup"); gC.label="Complex functions · Pólya";
for(const k in SYS){const o=document.createElement("option");o.value=k;o.textContent=SYS[k].name;(SYS[k].group==="complex"?gC:gF).appendChild(o);}
sel.appendChild(gF); sel.appendChild(gC); sel.value=cur;
sel.addEventListener("change",()=>selectSystem(sel.value));

// Tracer count, speed, and trail-length sliders. Density change respawns the pool.
$("rDen").addEventListener("input",function(){cfg.den=+this.value;$("vDen").textContent=this.value;setRange(this);spawnTracers();});
$("rSpd").addEventListener("input",function(){cfg.spd=+this.value;$("vSpd").textContent=(this.value/10).toFixed(1);setRange(this);});
$("rTrl").addEventListener("input",function(){cfg.trl=+this.value;$("vTrl").textContent=this.value;setRange(this);});
[$("rDen"),$("rSpd"),$("rTrl")].forEach(setRange);
// Palette selector; repaint the tone-curve preview on change.
$("palSel").addEventListener("change",e=>{cfg.palette=e.target.value;drawToneCurve();});
// Tone-curve sliders (gamma, contrast, exposure), each repainting the preview.
[["rGamma","vGamma","gamma"],["rContrast","vContrast","contrast"],["rExposure","vExposure","exposure"]].forEach(a=>{const r=$(a[0]);setRange(r);r.addEventListener("input",()=>{cfg[a[2]]=parseFloat(r.value);$(a[1]).textContent=cfg[a[2]].toFixed(2);setRange(r);drawToneCurve();});});
// Segmented tracer-color mode (speed / phase / mono).
$("colMode").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;[...$("colMode").children].forEach(x=>x.classList.remove("on"));b.classList.add("on");cfg.colMode=b.dataset.m;});
// Generic toggle-button binder: flip a cfg flag and run an optional side effect.
function tog(id,key,after){const el=$(id);el.addEventListener("click",()=>{cfg[key]=!cfg[key];el.classList.toggle("on",cfg[key]);if(after)after();});}
// Display toggles: domain image (marks it dirty), arrows, axes, inset panel.
tog("tDom","dom",()=>{domDirty=true;});
tog("tArr","arr");
tog("tAxes","axes");
tog("tSim","sim",()=>{$("msim-panel").classList.toggle("hidden",!cfg.sim);});
// Playback controls: pause/resume the loop, reset the model + tracers, clear trails.
$("btnPlay").addEventListener("click",function(){cfg.playing=!cfg.playing;this.textContent=cfg.playing?"Play":"Pause";this.classList.toggle("active",cfg.playing);});
$("btnReset").addEventListener("click",()=>{resetPS();spawnTracers();});
$("btnClear").addEventListener("click",()=>{trLen.fill(0);});
// Collapse/expand the governing-equations panel.
$("eq-toggle").addEventListener("click",()=>{const p=$("eq-panel");const c=p.classList.toggle("collapsed");p.querySelector(".arrow").textContent=c?"▼":"▲";});

/* pan / zoom */
// Drag to pan: convert pixel deltas to world units and shift the view center.
let drag=false,lx=0,ly=0;
canvas.addEventListener("pointerdown",e=>{drag=true;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener("pointerup",()=>drag=false);
canvas.addEventListener("pointermove",e=>{if(!drag)return;view.cx-=(e.clientX-lx)/view.scale;view.cy+=(e.clientY-ly)/view.scale;lx=e.clientX;ly=e.clientY;domDirty=true;});
// Wheel to zoom about the cursor: keep the world point under the pointer fixed
// while scaling, clamped to a sane zoom range.
canvas.addEventListener("wheel",e=>{e.preventDefault();const r=canvas.getBoundingClientRect();const ax=wx((e.clientX-r.left)),ay=wy((e.clientY-r.top));view.scale*=(1-e.deltaY*0.0012);view.scale=Math.max(12,Math.min(900,view.scale));view.cx=ax-((e.clientX-r.left)-CW/2)/view.scale;view.cy=ay+((e.clientY-r.top)-CH/2)/view.scale;domDirty=true;},{passive:false});
// Two-finger pinch zoom: scale by the change in finger distance.
let pinch=0;
canvas.addEventListener("touchmove",e=>{if(e.touches.length===2){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY,d=Math.hypot(dx,dy);if(pinch){view.scale*=d/pinch;view.scale=Math.max(12,Math.min(900,view.scale));domDirty=true;}pinch=d;e.preventDefault();}},{passive:false});
canvas.addEventListener("touchend",()=>pinch=0);

/* loop */
// Per-frame driver: step physics when playing, render, and throttle the status
// bar and FPS readout to a few updates per second.
let last=0,fc=0,ft=0,capT=0,rafId=0,started=false;
function loop(t){
  rafId=requestAnimationFrame(loop);
  const dt=Math.min((t-last)/1000,0.05); last=t;
  fc++;ft+=dt; if(ft>=0.5){$("st-fps").textContent=Math.round(fc/ft)+" fps";fc=0;ft=0;}
  if(cfg.playing){updateTracers(dt); updatePS(dt);}
  render();
  if(cfg.sim) drawMSim();
  capT+=dt;
  if(capT>0.12){capT=0;
    $("st-tr").textContent=TR_N+" tracers";
    $("st-state").innerHTML="x <b>"+ps.x.toFixed(2)+"</b> y <b>"+ps.y.toFixed(2)+"</b>";
    $("st-zoom").textContent=(view.scale/(Math.min(CW,CH)/(2*SYS[cur].view.span))).toFixed(2)+"×";
    if(cfg.sim)$("msim-vars").innerHTML=varCaption();
  }
}

// Re-fit and respawn on container resize; ResizeObserver when available.
if(window.ResizeObserver)new ResizeObserver(()=>{resize();spawnTracers();}).observe(document.getElementById("canvas-wrap"));
else window.addEventListener("resize",()=>{resize();spawnTracers();});

// Stop the loop while the page is hidden. The browser already stops rAF in a
// hidden tab. On return, reset last so the first dt is near zero.
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){ if(rafId){cancelAnimationFrame(rafId);rafId=0;} }
  else if(!rafId&&started){ last=performance.now(); rafId=requestAnimationFrame(loop); }
});

// Boot after a short delay so layout has settled: size, set the default
// tracer count from the canvas area, draw the tone curve, select the default
// system, and start the loop.
setTimeout(()=>{
  resize();
  const r=$("rDen"); r.value=cfg.den=tracerBudget(); $("vDen").textContent=r.value; setRange(r);
  drawToneCurve(); selectSystem("pendulum");
  started=true; last=performance.now(); rafId=requestAnimationFrame(loop);
},40);

// Screensaver hook for the shell (lib/screensaver.js). enter() waits for the boot
// selectSystem, hides the GUI, makes #canvas-wrap fill the window (the observer
// then calls resize() and respawns the tracers), and shows one system chosen by
// opts.seed with no axes, arrows or inset. calm 1 halves the tracer speed. The
// system does not change inside one dwell, so there is no respawn cut.
// saverOn moves the tracers by stepAlong() ("SAVER STEP"): the same
// streamlines at a bounded screen speed. The systems are the bounded flows
// and the complex maps; log z is out (its branch cut tears the trails).
// saverPlate() then sends the shell label plate the equations of that system.
window.snSaver={async enter(opts){const calm=Math.max(0,Math.min(1,+opts.calm||0));
  while(!started)await new Promise(r=>setTimeout(r,50));
  const st=document.createElement("style");st.textContent="html.saver #panel,html.saver #mob-btn,html.saver .mob-overlay,html.saver #eq-panel,html.saver #msim-panel,html.saver #status-bar,html.saver .topbar{display:none!important}html.saver #canvas-wrap{position:fixed;inset:0;z-index:1}html.saver #sim-canvas{cursor:none}";
  document.head.appendChild(st);document.documentElement.classList.add("saver");
  const keys=["vdp","duffing","lotka","pendulum","spiral","cjou","cinv","cz2","cz3","csin"].filter(k=>SYS[k]);saverOn=true;
  cfg.sim=false;cfg.axes=false;cfg.arr=false;cfg.dom=false;cfg.playing=true;cfg.spd=14*(1-0.5*calm);cfg.trl=Math.max(cfg.trl,72);
  selectSystem(keys[(opts.seed>>>0)%keys.length]);resize();spawnTracers();
  if(opts.labels!==false&&typeof opts.label==="function")try{opts.label(saverPlate());}catch(e){}
  return{canvas,warmupMs:2500};}};

/* ════════ saver plate ════════ */
// Plain-text dx/dt and dy/dt of each system, the same field that fieldAt()
// gives the tracers: the Unicode fallback (eq) of the shell label plate. A
// complex map shows its Pólya field (Re f, −Im f).
const ODE={
  pendulum:{sub:"x = θ,  y = ω",eq:["ẋ = y","ẏ = −sin x − ζ y"]},
  vdp:     {sub:"y = ẋ",eq:["ẋ = y","ẏ = μ (1 − x²) y − x"]},
  duffing: {sub:"y = ẋ,  V(x) = −x²/2 + x⁴/4",eq:["ẋ = y","ẏ = x − x³ − ζ y"]},
  lotka:   {sub:"prey x,  predator y",eq:["ẋ = a x − x y","ẏ = x y − b y"]},
  spiral:  {sub:"eigenvalues −c ± iω",eq:["ẋ = −c x − ω y","ẏ = ω x − c y"]},
  saddle:  {sub:"eigenvalues ± a",eq:["ẋ = a x","ẏ = −a y"]},
  cz2:     {sub:"Pólya field (Re f, −Im f)",eq:["ẋ = x² − y²","ẏ = −2 x y"]},
  cz3:     {sub:"Pólya field (Re f, −Im f)",eq:["ẋ = x³ − 3 x y²","ẏ = y³ − 3 x² y"]},
  cinv:    {sub:"Pólya field (Re f, −Im f)",eq:["ẋ = x / (x² + y²)","ẏ = y / (x² + y²)"]},
  cjou:    {sub:"Pólya field (Re f, −Im f)",eq:["ẋ = x − x / (x² + y²)","ẏ = −y − y / (x² + y²)"]},
  csin:    {sub:"Pólya field (Re f, −Im f)",eq:["ẋ = sin x cosh y","ẏ = −cos x sinh y"]},
  clog:    {sub:"Pólya field (Re f, −Im f)",eq:["ẋ = ½ ln(x² + y²)","ẏ = −arg z"]}
};
// The dx/dt, dy/dt form as TeX where eqs() has none (the Duffing well and
// the complex maps): the Pólya field of each map, as in ODE.
const ODE_TEX={
  duffing:"\\dot{x}=y,\\qquad \\dot{y}=x-x^3-\\zeta\\,y",
  cz2:"\\dot{x}=x^2-y^2,\\qquad \\dot{y}=-2xy",
  cz3:"\\dot{x}=x^3-3xy^2,\\qquad \\dot{y}=y^3-3x^2y",
  cinv:"\\dot{x}=\\frac{x}{x^2+y^2},\\qquad \\dot{y}=\\frac{y}{x^2+y^2}",
  cjou:"\\dot{x}=x-\\frac{x}{x^2+y^2},\\qquad \\dot{y}=-y-\\frac{y}{x^2+y^2}",
  csin:"\\dot{x}=\\sin x\\cosh y,\\qquad \\dot{y}=-\\cos x\\sinh y",
  clog:"\\dot{x}=\\tfrac12\\ln(x^2+y^2),\\qquad \\dot{y}=-\\arg z"
};
// The shell label plate of the current system: the panel TeX of eqs() in
// the sysRules() colours, then the dx/dt form of ODE_TEX. Params are the
// system parameters (m4, m5 as in sysRules), the tracer count and the view
// span. No anchor: the phase portrait fills the screen, so the plate sits
// at the lower right.
function saverPlate(){const S=SYS[cur],E=ODE[cur]||{sub:"",eq:[]};
  const tex=S.eqs().map(b=>plainTeX(b.tex));if(ODE_TEX[cur])tex.splice(1,0,ODE_TEX[cur]);
  const params=Object.keys(S.params||{}).slice(0,2).map((k,i)=>({sym:paramSym(S.params[k].l),name:paramWord(S.params[k].l)||"parameter",value:(+P[k]).toFixed(2),cls:"m"+(4+i)}));
  params.push({sym:"N",name:"tracers",value:String(TR_N)},{sym:"L",name:"view span",value:S.view.span.toFixed(1)});
  return{title:S.name,sub:S.group==="complex"?"Pólya field of a complex map":"Phase portrait of a planar flow",
    params,lines:E.sub&&S.group!=="complex"?[E.sub]:[],tex:tex.slice(0,4),rules:sysRules(),eq:E.eq};}
