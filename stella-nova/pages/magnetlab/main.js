// ============================================================================
//  MAGNETLAB  ·  2D magnetic field simulator  (canvas 2D)
// ----------------------------------------------------------------------------
//  Every magnet is a rigid body carrying a set of point dipoles ("poles"). The
//  field at any point is the vector sum of each pole's dipole field. Massless
//  tracer particles ride that field like iron filings, and dynamic magnets feel
//  the force and torque the field exerts on their own poles. All of it draws to
//  one canvas through a pan/zoom camera transform.
//
//  FIELD MODEL   (one pole, in the pole's local frame)
//  --------------------------------------------------------------------------
//      B(r) = FIELD_SCALE * ( 3(m·r̂)r̂ − m ) / r³        point dipole
//
//         S ●━━━▶━━━ N        m points S→N; field loops N back to S
//          ╲   ╱ ╲   ╱
//           ╲ ╱   ╲ ╱         tracers follow B̂, biased to spawn near tips
//            ●     ●
//
//  SIMULATION LOOP   (loop(), 60 Hz via requestAnimationFrame)
//  --------------------------------------------------------------------------
//      integrateMagnets()   spin, then force+torque, then collisions
//      refreshFrameCache()  poles, magnet boxes, spawn tips, view box
//      updateTracers(dt)    step each tracer along B̂, respawn when dead
//      render()             clear ▶ camera ▶ grid ▶ layers ▶ magnets
//  The loop stops while the page is hidden (visibilitychange).
//
//  TRACER DRAW
//      Trails live in typed ring buffers. renderTracersGL() draws all trails
//      in one instanced WebGL call on a hidden canvas, with a smooth fade and
//      color along each trail. render() adds that canvas with 'lighter'.
//      renderTracers2D() is the bucket fallback when WebGL is not available.
//
//  COORDINATE FRAMES
//      screen px ── screenToWorld() ──▶ world px ── camera transform ──▶ canvas
//      CW / CH   = logical CSS-pixel size of the canvas (physics units)
//      CAM.x/y   = world offset from centre;  CAM.zoom = scale factor
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      state ................ "const SIM ="        sim flags + tuning
//      camera / viewport .... "CAMERA / VIEWPORT"   screen↔world mapping
//      magnet factory ....... "MAGNET FACTORY"      pole layouts per type
//      physics .............. "PHYSICS"             field, forces, collisions
//      pole cache ........... "function refreshFrameCache"  per-frame cache
//      field sum ............ "function fieldAt"    field from the pole cache
//      tracers .............. "TRACERS"             spawn + step iron filings
//      streamer budget ...... "function tracerBudget"  default count by area
//      colors ............... "COLORS"              field magnitude → RGB ramp
//      render ............... "function render"     the per-frame draw
//      tracer shaders ....... "TR_VS" / "TR_FS"     segment quad + glow/core
//      tracer draw .......... "function renderTracersGL"  one instanced call
//      magnet drawing ....... "function renderMagnets"  per-type glyphs
//      ui wiring ............ "UI WIRING"           panel + card controls
//      drag + zoom .......... "DRAG + ZOOM"         mouse/touch input
//      resize ............... "function resize"     ResizeObserver sizing
//      loop ................. "function loop"        the frame driver
//      hidden page .......... "visibilitychange"     stop / restart loop
//      init ................. "INIT"                first magnet + start
//      screensaver .......... "SCREENSAVER"         window.snSaver scene tour
//      saver scenes ......... "const SAVER_SCENES"  configurations + labels
//      iron filings ......... "function renderFilings"  saver-only layer
//      tracer colour mode ... "uMode"               |B|, direction or silver
// ============================================================================

/* ════════════════════════════════════════════════════════════
   MAGNETLAB — 2D MAGNETIC FIELD SIMULATOR
   CW / CH = logical CSS-pixel dimensions of the canvas.
   All physics, spawning, hit-testing, and rendering use CW/CH.
   ════════════════════════════════════════════════════════════ */

// The canvas and its 2D context. CW/CH track the wrapper's CSS size and are the
// unit system for all physics, spawning, hit-testing, and rendering.
const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
let CW = 100, CH = 100;

// The one mutable state bag: display toggles, tracer tuning, the physics
// timestep, velocity damping factors, and which magnet is selected.
const SIM = {
  playing:true, showTracers:true, showArrows:true, showHeatmap:false,
  tracerCount:2500, tracerSpeed:1.5, tracerTrail:40,
  // Screensaver-only layers: trMode is the tracer colour mode (see TR_FS),
  // showFilings draws the iron-filings layer (renderFilings).
  trMode:0, showFilings:false,
  dt:1/60, damping:0.97, angDamping:0.85, selectedId:-1,
};

// The scene: all magnets, all tracer particles, and a monotonic id counter.
let magnets=[], tracers=[], nextId=0;

/* ═══ CAMERA / VIEWPORT ═══ */
const CAM = { x:0, y:0, zoom:1 }; // x,y = world offset from center, zoom = scale factor

// Invert the camera transform: map a screen pixel back to a world coordinate.
// Used by input handling and by the spawn/visibility tests below.
function screenToWorld(sx, sy){
  return [(sx - CW/2) / CAM.zoom + CW/2 - CAM.x,
          (sy - CH/2) / CAM.zoom + CH/2 - CAM.y];
}


/* ═══ MAGNET FACTORY ═══ */
// Build one magnet of the given type at (x,y). Every type shares the same rigid
// body fields; the switch fills in size, mass, inertia, and the pole layout.
// A pole is {dx,dy,mx,my}: an offset in the body frame and a dipole-moment
// vector. angle starts at -PI/2 so bar-like magnets point up on spawn.
function createMagnet(type,x,y){
  const m={id:nextId++,type,x,y,angle:-Math.PI/2,strength:1.0,spin:0,fixed:true,vx:0,vy:0,va:0,mass:1,inertia:1};
  switch(type){
    // Bar magnet: five aligned poles in a row make a smooth two-ended field.
    case 'bar':
      m.w=100;m.h=30;m.poles=[];
      for(let i=-2;i<=2;i++) m.poles.push({dx:i*20,dy:0,mx:1,my:0});
      m.mass=2;m.inertia=2;break;
    // Dipole: a single point pole; the simplest field source.
    case 'dipole':
      m.w=36;m.h=36;m.poles=[{dx:0,dy:0,mx:1,my:0}];
      m.mass=0.5;m.inertia=0.3;break;
    // Solenoid: a denser, stronger row of poles, standing in for a coil.
    case 'solenoid':
      m.w=80;m.h=50;m.poles=[];m.strength=1.5;
      for(let i=-3;i<=3;i++) m.poles.push({dx:i*10,dy:0,mx:2,my:0});
      m.mass=3;m.inertia=3;break;
    // Horseshoe: poles trace a U so both tips point the same way, concentrating
    // the field in the gap between the arms.
    case 'horseshoe':
      m.w=60;m.h=70;m.poles=[
        {dx:25,dy:-30,mx:0,my:-1},{dx:25,dy:-15,mx:0.5,my:-0.5},
        {dx:25,dy:0,mx:1,my:0},{dx:25,dy:15,mx:0.5,my:0.5},
        {dx:15,dy:28,mx:0,my:1},{dx:0,dy:32,mx:-0.3,my:1},{dx:-15,dy:28,mx:0,my:1},
        {dx:-25,dy:15,mx:-0.5,my:0.5},{dx:-25,dy:0,mx:-1,my:0},{dx:-25,dy:-15,mx:-0.5,my:-0.5},
        {dx:-25,dy:-30,mx:0,my:-1}
      ];m.mass=2.5;m.inertia=2.5;break;
    // Buzzer: a dense disc of aligned poles, a strong compact dipole.
    case 'buzzer':
      m.w=44;m.h=44;m.poles=[{dx:0,dy:0,mx:1.5,my:0}];
      // Dense disc: center + 6 in a ring, all aligned
      for(let i=0;i<6;i++){const a=i*Math.PI/3;m.poles.push({dx:Math.cos(a)*14,dy:Math.sin(a)*14,mx:1,my:0});}
      m.mass=1.5;m.inertia=1.2;break;
    // Ring: eight poles pointing radially outward, so the field blooms outward
    // all around rather than from two ends.
    case 'ring':
      m.w=56;m.h=56;m.poles=[];
      // 8 dipoles pointing radially outward
      for(let i=0;i<8;i++){const a=i*Math.PI/4;const cx=Math.cos(a),sy=Math.sin(a);
        m.poles.push({dx:cx*22,dy:sy*22,mx:cx*1.2,my:sy*1.2});}
      m.mass=2;m.inertia=2;break;
    // Quadrupole: two N and two S poles at the cardinal points, giving the
    // four-lobed field that focuses charged beams in accelerators.
    case 'quadrupole':
      m.w=50;m.h=50;m.poles=[
        {dx:22,dy:0,mx:1.5,my:0},   // N right
        {dx:0,dy:22,mx:0,my:1.5},   // N down
        {dx:-22,dy:0,mx:-1.5,my:0}, // S left (points inward = N right repels)
        {dx:0,dy:-22,mx:0,my:-1.5}  // S up
      ];m.mass=2;m.inertia=2;m.strength=1.2;break;
    // Halbach array: each pole is rotated 90 degrees from the last, which
    // reinforces the field on one face and cancels it on the other.
    case 'halbach':
      m.w=130;m.h=30;m.poles=[];
      // Each dipole rotated 90° from previous → field concentrates on one side
      for(let i=0;i<6;i++){
        const a=i*Math.PI/2; // 0, 90, 180, 270, 0, 90...
        m.poles.push({dx:(i-2.5)*22,dy:0,mx:Math.cos(a)*1.5,my:Math.sin(a)*1.5});}
      m.mass=3;m.inertia=3;m.strength=1.3;break;
  }
  return m;
}

/* ═══ PHYSICS ═══ */
const FIELD_SCALE = 80000; // compensates for 1/r³ falloff at pixel-scale distances

// The point-dipole field at offset (px,py) from a pole with moment (mx,my).
// This is B = (3(m·r̂)r̂ − m)/r³ written out in Cartesian form. The r<5 guard
// clamps the singularity at the pole so the field stays finite up close.
function dipoleField(px,py,mx,my){
  const r2=px*px+py*py,r=Math.sqrt(r2);
  if(r<5)return[0,0];
  const r3=r2*r,r5=r3*r2,mdotr=mx*px+my*py;
  return[(3*mdotr*px/r5-mx/r3)*FIELD_SCALE,(3*mdotr*py/r5-my/r3)*FIELD_SCALE];
}

// Pole cache. Once per frame, refreshFrameCache() writes each pole in world
// space into flat typed arrays. The field loops then read plain numbers. They
// do not do a sin/cos per magnet or allocate a result array per sample.
//   _pc   = [sx, sy, mmx, mmy] per pole (world position, scaled moment)
//   _mb   = [x, y, cos(-a), sin(-a), halfW+pad, halfH+pad] per magnet
//   _tips = [x, y] per spawn tip, for spawnPos
//   _vb   = world box on screen; tracers respawn and cull against it
let _pc=new Float64Array(64*4), _pn=0;
let _mb=new Float64Array(16*6), _mn=0;
let _tips=new Float64Array(64*2), _tn=0;
let _vb={x0:0,y0:0,x1:0,y1:0};
function refreshFrameCache(){
  let np=0; for(const m of magnets) np+=m.poles.length;
  if(_pc.length<np*4) _pc=new Float64Array(np*8);
  if(_mb.length<magnets.length*6) _mb=new Float64Array(magnets.length*12);
  if(_tips.length<magnets.length*6) _tips=new Float64Array(magnets.length*12);
  let k=0, j=0, t=0;
  for(const mag of magnets){
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    for(const p of mag.poles){
      _pc[k++]=mag.x+p.dx*ca-p.dy*sa; _pc[k++]=mag.y+p.dx*sa+p.dy*ca;
      _pc[k++]=(p.mx*ca-p.my*sa)*mag.strength; _pc[k++]=(p.mx*sa+p.my*ca)*mag.strength;
    }
    // Body box for isInsideMagnet: 6 px pad, as before.
    _mb[j++]=mag.x; _mb[j++]=mag.y; _mb[j++]=ca; _mb[j++]=-sa;
    _mb[j++]=mag.w*0.5+6; _mb[j++]=mag.h*0.5+6;
    // Spawn tips: first and last poles, plus the middle pole on long magnets.
    const P=mag.poles, n=P.length;
    const tipList = n<=2 ? P : [P[0],P[n-1],P[Math.floor(n/2)]];
    for(const p of tipList){ _tips[t++]=mag.x+p.dx*ca-p.dy*sa; _tips[t++]=mag.y+p.dx*sa+p.dy*ca; }
  }
  _pn=np; _mn=magnets.length; _tn=t>>1;
  const [x0,y0]=screenToWorld(0,0), [x1,y1]=screenToWorld(CW,CH);
  _vb.x0=x0; _vb.y0=y0; _vb.x1=x1; _vb.y1=y1;
}

// Total field at a world point from the pole cache. The result goes into FBx
// and FBy, so a call makes no garbage. Same math as dipoleField, summed over
// every pole, with the same r<5 guard.
let FBx=0, FBy=0;
function fieldAt(wx,wy){
  let Bx=0,By=0;
  for(let k=0,e=_pn*4;k<e;k+=4){
    const px=wx-_pc[k], py=wy-_pc[k+1];
    const r2=px*px+py*py;
    if(r2<25) continue;
    const r=Math.sqrt(r2), r3=r2*r, r5=r3*r2;
    const mx=_pc[k+2], my=_pc[k+3], md=3*(mx*px+my*py)/r5;
    Bx+=md*px-mx/r3; By+=md*py-my/r3;
  }
  FBx=Bx*FIELD_SCALE; FBy=By*FIELD_SCALE;
}
// Same sum as fieldAt, but skipping one magnet by id. A magnet must not feel
// its own field, so force and torque use this to see only its neighbours.
function fieldFromOthers(wx,wy,exId){
  let Bx=0,By=0;
  for(const mag of magnets){
    if(mag.id===exId)continue;
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    for(const p of mag.poles){
      const sx=mag.x+p.dx*ca-p.dy*sa,sy=mag.y+p.dx*sa+p.dy*ca;
      const mmx=(p.mx*ca-p.my*sa)*mag.strength,mmy=(p.mx*sa+p.my*ca)*mag.strength;
      const[bx,by]=dipoleField(wx-sx,wy-sy,mmx,mmy);
      Bx+=bx;By+=by;
    }
  }
  return[Bx,By];
}
// Advance every magnet one physics step: driven spin, then magnetic force and
// torque on dynamic bodies, then collision resolution. Fixed magnets and the
// one being dragged are held in place but still act as field sources.
function integrateMagnets(){
  // ── Apply preset spin to ALL magnets (fixed or dynamic) ──
  for(const mag of magnets){
    if(mag.spin!==0 && mag!==dragMag) mag.angle+=mag.spin*SIM.dt;
  }

  // ── Magnetic forces & torque (dynamic only) ──
  for(const mag of magnets){
    if(mag.fixed||mag===dragMag)continue;
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    let Fx=0,Fy=0,torque=0;
    for(const p of mag.poles){
      const sx=mag.x+p.dx*ca-p.dy*sa,sy=mag.y+p.dx*sa+p.dy*ca;
      const mmx=(p.mx*ca-p.my*sa)*mag.strength,mmy=(p.mx*sa+p.my*ca)*mag.strength;
      const[Bx,By]=fieldFromOthers(sx,sy,mag.id);
      // Force on a dipole is F = grad(m·B). Sample B at four points a step h
      // apart and take central differences to get the gradient numerically.
      const h=2;
      const[Bxr,Byr]=fieldFromOthers(sx+h,sy,mag.id);
      const[Bxl,Byl]=fieldFromOthers(sx-h,sy,mag.id);
      const[Bxu,Byu]=fieldFromOthers(sx,sy+h,mag.id);
      const[Bxd,Byd]=fieldFromOthers(sx,sy-h,mag.id);
      Fx+=(mmx*(Bxr-Bxl)+mmy*(Byr-Byl))/(2*h)*6000;
      Fy+=(mmx*(Bxu-Bxd)+mmy*(Byu-Byd))/(2*h)*6000;
      // Torque on a dipole is m × B; in 2D that cross product is the scalar
      // (mx*By − my*Bx), which turns the magnet toward field alignment.
      torque+=(mmx*By-mmy*Bx)*1200;
    }
    // Clamp force and torque so a close approach cannot blow the body up.
    const fMag=Math.sqrt(Fx*Fx+Fy*Fy),fMax=4000;
    if(fMag>fMax){Fx*=fMax/fMag;Fy*=fMax/fMag;}
    torque=Math.max(-1500,Math.min(1500,torque));
    // Semi-implicit Euler: integrate velocity from force, then damp it. Linear
    // and angular velocities decay each step so motion settles.
    mag.vx=(mag.vx+Fx/mag.mass*SIM.dt)*SIM.damping;
    mag.vy=(mag.vy+Fy/mag.mass*SIM.dt)*SIM.damping;
    mag.va=(mag.va+torque/mag.inertia*SIM.dt)*SIM.angDamping;
    // Hard cap on angular velocity to prevent spin blowup
    mag.va=Math.max(-3,Math.min(3,mag.va));
    mag.x+=mag.vx*SIM.dt;mag.y+=mag.vy*SIM.dt;mag.angle+=mag.va*SIM.dt;
    // Wall bounce: keep the body inside a margin and reverse velocity at half
    // energy so it does not escape the canvas.
    const M=40;
    if(mag.x<M){mag.x=M;mag.vx*=-0.5;}if(mag.x>CW-M){mag.x=CW-M;mag.vx*=-0.5;}
    if(mag.y<M){mag.y=M;mag.vy*=-0.5;}if(mag.y>CH-M){mag.y=CH-M;mag.vy*=-0.5;}
  }

  // ── Magnet-magnet collisions with contact damping (spring-dashpot) ──
  // Each pair is resolved as a soft spring plus a dashpot: a graduated repulsion
  // as they near, position correction and an impulse on hard overlap, and
  // velocity damping throughout so bodies settle instead of jittering.
  const restitution = 0.1;  // nearly inelastic — magnets stick rather than bounce
  const COLL_PAD = 14;      // padding so magnets settle with a visible gap
  const SKIN = 30;          // proximity zone for soft forces
  const CONTACT_DAMP = 12;  // dashpot coefficient — absorbs relative velocity
  const ANG_CONTACT_DAMP = 0.7; // angular damping when in proximity

  // Test each unordered pair once; radii are half the larger body dimension
  // plus padding so magnets keep a visible gap at rest.
  for(let i=0;i<magnets.length;i++){
    const a=magnets[i];
    const ra=Math.max(a.w,a.h)*0.5 + COLL_PAD;
    for(let j=i+1;j<magnets.length;j++){
      const b=magnets[j];
      const rb=Math.max(b.w,b.h)*0.5 + COLL_PAD;
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const minDist=ra+rb;
      if(dist<0.1)continue;

      const nx=dx/dist, ny=dy/dist;
      const aFixed=a.fixed||a===dragMag, bFixed=b.fixed||b===dragMag;

      // ── Proximity zone: soft repulsion + velocity damping (dashpot) ──
      if(dist<minDist+SKIN){
        // Relative velocity along normal (positive = approaching)
        const rvx=(a.vx||0)-(b.vx||0), rvy=(a.vy||0)-(b.vy||0);
        const rvn=rvx*nx+rvy*ny;

        if(dist>=minDist){
          // Skin zone: graduated repulsion + damping
          const t=1-(dist-minDist)/SKIN; // 0 at edge, 1 at boundary
          const skinForce=t*600;
          const dampForce=rvn*CONTACT_DAMP*t; // damp relative approach
          const totalF=skinForce+dampForce;
          if(!aFixed){a.vx-=nx*totalF*SIM.dt/a.mass;a.vy-=ny*totalF*SIM.dt/a.mass;}
          if(!bFixed){b.vx+=nx*totalF*SIM.dt/b.mass;b.vy+=ny*totalF*SIM.dt/b.mass;}
        } else {
          // Hard overlap: position correction + strong damping
          const overlap=minDist-dist;
          if(!(aFixed&&bFixed)){
            if(aFixed){b.x+=nx*overlap;b.y+=ny*overlap;}
            else if(bFixed){a.x-=nx*overlap;a.y-=ny*overlap;}
            else{a.x-=nx*overlap*0.5;a.y-=ny*overlap*0.5;b.x+=nx*overlap*0.5;b.y+=ny*overlap*0.5;}
          }

          // Velocity exchange (nearly inelastic)
          if(!aFixed&&!bFixed){
            if(rvn>0){
              const impulse=rvn*(1+restitution)/(1/a.mass+1/b.mass);
              a.vx-=impulse/a.mass*nx;a.vy-=impulse/a.mass*ny;
              b.vx+=impulse/b.mass*nx;b.vy+=impulse/b.mass*ny;
            }
          } else if(aFixed&&!bFixed){
            const bvn=b.vx*nx+b.vy*ny;
            if(bvn<0){b.vx-=2*bvn*nx*restitution;b.vy-=2*bvn*ny*restitution;}
          } else if(!aFixed&&bFixed){
            const avn=a.vx*nx+a.vy*ny;
            if(avn>0){a.vx-=2*avn*nx*restitution;a.vy-=2*avn*ny*restitution;}
          }

          // Strong contact damping — kill remaining relative velocity
          const dampF=rvn*CONTACT_DAMP;
          if(!aFixed){a.vx-=nx*dampF*SIM.dt/a.mass;a.vy-=ny*dampF*SIM.dt/a.mass;}
          if(!bFixed){b.vx+=nx*dampF*SIM.dt/b.mass;b.vy+=ny*dampF*SIM.dt/b.mass;}
        }

        // Angular damping when in proximity — helps magnets align and stop spinning
        if(!aFixed) a.va*=ANG_CONTACT_DAMP;
        if(!bFixed) b.va*=ANG_CONTACT_DAMP;
      }
    }
  }
}

/* ═══ TRACERS ═══ */
// Tracers are massless particles that ride the field like iron filings. They
// spawn biased toward pole tips (where the field is richest), step along the
// field direction each frame, and respawn when they age out or leave view.
//
// Storage is flat typed arrays, sized once per spawnTracers(). Each tracer has
// a ring of TRAIL_MAX trail points. The ring head is the newest point. A frame
// writes one point per tracer and allocates nothing.
//   trX/trY/trC  trail point x, y and color level (shaped field magnitude)
//   trHead/trLen ring head index and number of valid points
//   tPX/tPY      current position; tAge/tMax age and lifetime in seconds
const TRAIL_MAX=80; // equal to the Trail slider max
let TR_N=0;
let trX=new Float32Array(0), trY=new Float32Array(0), trC=new Float32Array(0);
let trHead=new Int32Array(0), trLen=new Int32Array(0);
let tPX=new Float64Array(0), tPY=new Float64Array(0);
let tAge=new Float32Array(0), tMax=new Float32Array(0);

// Streamer budget. The default count scales with the canvas area, so a phone
// does not get the same 2500 tracers as a desktop. The desktop default stays
// 2500. The Count slider can still set any value.
function tracerBudget(){
  const n=Math.round(CW*CH*0.00225/50)*50;
  return Math.max(800,Math.min(2500,n));
}

// Color level of a field magnitude: the log + clamp from fieldColorRGB with
// gamma 1. The trail stores this level, so the draw does no log per point.
function fieldLevel(B){
  let lc=Math.log10(1+B*8)/2.2; return lc<0?0:(lc>1?1:lc);
}

// Pick a spawn point: usually near a pole tip (Gaussian-ish clustered radius),
// sometimes anywhere in view, and never inside a magnet body. The result goes
// into SPX/SPY. The tips and view box come from refreshFrameCache().
let SPX=0, SPY=0;
function spawnPos(){
  // 65% near poles, 35% random — reject positions inside magnets
  const vb=_vb;
  for(let attempt=0;attempt<10;attempt++){
    let x,y;
    if(_tn>0 && Math.random()<0.65){
      const ti=Math.floor(Math.random()*_tn)*2;
      const r=(Math.random()+Math.random()+Math.random())/3 * 35 + 8;
      const a=Math.random()*Math.PI*2;
      x=_tips[ti]+Math.cos(a)*r; y=_tips[ti+1]+Math.sin(a)*r;
    } else {
      x=vb.x0+Math.random()*(vb.x1-vb.x0);
      y=vb.y0+Math.random()*(vb.y1-vb.y0);
    }
    if(!isInsideMagnet(x,y)){ SPX=x; SPY=y; return; }
  }
  SPX=vb.x0+Math.random()*(vb.x1-vb.x0); SPY=vb.y0+Math.random()*(vb.y1-vb.y0);
}

// Test if point is inside any magnet's oriented bounding box (with padding).
// Reads the magnet boxes from the frame cache.
function isInsideMagnet(px,py){
  for(let j=0,e=_mn*6;j<e;j+=6){
    const dx=px-_mb[j], dy=py-_mb[j+1];
    const ca=_mb[j+2], sa=_mb[j+3];
    const lx=dx*ca-dy*sa, ly=dx*sa+dy*ca;
    if(Math.abs(lx)<_mb[j+4] && Math.abs(ly)<_mb[j+5]) return true;
  }
  return false;
}

// Put tracer i at a new spawn point with an empty trail and a new lifetime.
function respawnTracer(i){
  spawnPos(); tPX[i]=SPX; tPY[i]=SPY;
  trLen[i]=0; tAge[i]=0; tMax[i]=2.5+Math.random()*4;
}

// Rebuild the whole tracer pool. Called on count change, magnet edits, and
// resize. Each tracer gets a random lifetime so respawns stay staggered.
function spawnTracers(){
  refreshFrameCache();
  const n=SIM.tracerCount;
  if(n!==TR_N){
    TR_N=n;
    trX=new Float32Array(n*TRAIL_MAX); trY=new Float32Array(n*TRAIL_MAX); trC=new Float32Array(n*TRAIL_MAX);
    trHead=new Int32Array(n); trLen=new Int32Array(n);
    tPX=new Float64Array(n); tPY=new Float64Array(n);
    tAge=new Float32Array(n); tMax=new Float32Array(n);
  }
  for(let i=0;i<n;i++) respawnTracer(i);
}

// Step every tracer one frame: move along the unit field vector, push the new
// point onto its trail ring, then respawn if it aged out, left view, or
// entered a magnet. The trail point keeps the color level of the field at the
// step start, as before.
function updateTracers(dt){
  const speed=SIM.tracerSpeed*80, threshold=1e-6, margin=40;
  const vx0=_vb.x0-margin, vx1=_vb.x1+margin, vy0=_vb.y0-margin, vy1=_vb.y1+margin;
  for(let i=0;i<TR_N;i++){
    tAge[i]+=dt;
    let x=tPX[i], y=tPY[i];
    fieldAt(x,y);
    const Bmag=Math.sqrt(FBx*FBx+FBy*FBy);
    if(Bmag>threshold){ const s=speed*dt/Bmag; x+=FBx*s; y+=FBy*s; tPX[i]=x; tPY[i]=y; }
    const h=(trHead[i]+1)%TRAIL_MAX, o=i*TRAIL_MAX+h;
    trHead[i]=h; trX[o]=x; trY[o]=y; trC[o]=fieldLevel(Bmag);
    if(trLen[i]<TRAIL_MAX) trLen[i]++;
    // Kill if: aged out, out of visible bounds, OR inside a magnet body
    if(tAge[i]>tMax[i]||x<vx0||x>vx1||y<vy0||y>vy1||isInsideMagnet(x,y)) respawnTracer(i);
  }
}

/* ═══ COLORS — ported from orbital viewer's B-field tracer system ═══ */
// Returns [r,g,b] in 0-1 range, matching the orbital viewer exactly
// Ramp: dark-purple → blue → cyan → green → orange → white
// Map a field magnitude to an [r,g,b] ramp. A log curve compresses the huge
// dynamic range of a 1/r³ field, gamma reshapes it, and the result indexes a
// six-stop colour ramp from dark purple through to white.
// Map a normalized level 0..1 to the six-stop ramp. Both the tracer color
// buckets and fieldColorRGB read this one stop table, so the ramp has a single
// source. lc is the already-shaped level (log + gamma done by the caller).
const FIELD_RAMP_STOPS = [[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
function rampStopRGB(lc){
  const sv = lc * 5, si = Math.min(Math.floor(sv), 4), sf = sv - si;
  return [
    FIELD_RAMP_STOPS[si][0] + sf * (FIELD_RAMP_STOPS[si+1][0] - FIELD_RAMP_STOPS[si][0]),
    FIELD_RAMP_STOPS[si][1] + sf * (FIELD_RAMP_STOPS[si+1][1] - FIELD_RAMP_STOPS[si][1]),
    FIELD_RAMP_STOPS[si][2] + sf * (FIELD_RAMP_STOPS[si+1][2] - FIELD_RAMP_STOPS[si][2])
  ];
}
function fieldColorRGB(mag, gamma){
  gamma = gamma || 1.0;
  const lv = Math.log10(1 + mag * 8) / 2.2;
  const lc = Math.pow(Math.max(0, Math.min(1, lv)), 1 / Math.max(0.1, gamma));
  return rampStopRGB(lc);
}
// Same ramp as fieldColorRGB, formatted as an rgba() string at the given alpha.
function fieldColorCSS(mag, alpha, gamma){
  const [r,g,b] = fieldColorRGB(mag, gamma);
  return `rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},${alpha})`;
}

/* ═══ RENDER ═══ */
// Draw one frame: clear in device space, paint the background, apply the camera
// transform, then draw the grid and each enabled layer under it. Layer order is
// heatmap, arrows, tracers, magnets, so magnets sit on top.
function render(){
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.restore();

  // Background (full screen, no transform)
  ctx.fillStyle='#0e1118';
  ctx.fillRect(0,0,CW,CH);

  // Apply camera transform — all drawing below is in world coordinates
  ctx.save();
  ctx.translate(CW/2, CH/2);
  ctx.scale(CAM.zoom, CAM.zoom);
  ctx.translate(-CW/2 + CAM.x, -CH/2 + CAM.y);

  // Grid
  const vb=_vb;
  ctx.strokeStyle='rgba(150,200,255,0.03)';ctx.lineWidth=1/CAM.zoom;
  const gs=50;
  const gx0=Math.floor(vb.x0/gs)*gs, gy0=Math.floor(vb.y0/gs)*gs;
  for(let x=gx0;x<vb.x1;x+=gs){ctx.beginPath();ctx.moveTo(x,vb.y0);ctx.lineTo(x,vb.y1);ctx.stroke();}
  for(let y=gy0;y<vb.y1;y+=gs){ctx.beginPath();ctx.moveTo(vb.x0,y);ctx.lineTo(vb.x1,y);ctx.stroke();}

  if(SIM.showHeatmap) renderHeatmap();
  if(SIM.showFilings) renderFilings();
  if(SIM.showArrows) renderArrows();
  if(SIM.showTracers) renderTracers();
  renderMagnets();

  ctx.restore();
}

// Heatmap layer: fill a coarse grid of cells, each tinted by the field
// magnitude sampled at its origin.
function renderHeatmap(){
  const step=14;
  for(let x=0;x<CW;x+=step)for(let y=0;y<CH;y+=step){
    fieldAt(x,y);
    ctx.fillStyle=fieldColorCSS(Math.sqrt(FBx*FBx+FBy*FBy),0.4);
    ctx.fillRect(x,y,step,step);
  }
}
// Arrow layer: at each grid node draw a short arrow along the field direction,
// with length and brightness scaled by the log of the field magnitude.
function renderArrows(){
  ctx.save();
  ctx.globalCompositeOperation='lighter'; // additive blend like orbital viewer
  const step=28,maxLen=14;
  for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
    fieldAt(x,y);
    const Bx=FBx,By=FBy,Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag<1e-5)continue;
    const[r,g,b]=fieldColorRGB(Bmag);
    const lv=Math.min(1,Math.log10(1+Bmag*8)/2.2);
    const len=Math.max(3,lv*maxLen);
    const nx=Bx/Bmag,ny=By/Bmag;
    const alpha=Math.max(0.06,Math.min(0.5,lv*0.6));
    // Dim shaft color (0.35× like orbital viewer's instanced arrows)
    ctx.strokeStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;
    ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    if(len>4){
      const ax=x+nx*len,ay=y+ny*len,px=-ny*2.5,py=nx*2.5;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*4+px,ay-ny*4+py);ctx.lineTo(ax-nx*4-px,ay-ny*4-py);ctx.closePath();
      ctx.fillStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;
      ctx.fill();
    }
  }
  ctx.restore();
}
// Tracer layer (WebGL). All trails draw in ONE instanced call on a hidden
// WebGL canvas. render() then adds that canvas onto the 2D canvas with the
// 'lighter' blend, between the arrows and the magnets.
//
// Each instance is one trail segment. It reads four consecutive points P, A,
// B and N from one vertex buffer, [x, y, colorLevel, fade] per point. The
// segment is A to B. P and N are the neighbors, used for miter joins, so the
// quads of one trail share their joint edges: no gaps and no overlaps. Slot 0
// of the buffer is a pad, so instance i starts at slot i. On the newest
// point of a trail, colorLevel has +2 added. That flag gives the head segment
// a round cap at A, as the old round line caps did. Other segments have no
// cap, so the joints do not add twice. Each tracer uses
// trailLen+1 slots. The last slot has fade -1, so the segment into the next
// tracer collapses. The vertex shader expands the segment to a quad. Fade and
// color level interpolate along the quad, so the gradient along a trail is
// smooth. The old color and fade buckets made visible steps.
//
// The fragment shader adds a wide dim glow and a thin bright core, the same
// widths and gains as the old two stroke passes: glow max(1,5f) at 0.12, core
// max(0.5,1.8f) at 0.55, in world units, where f is the fade.
const glCanvas=document.createElement('canvas');
let gl=null, glInst=null, glOK=false, glLoc=null, glVBuf=null;
let glData=new Float32Array(0), glView=null, glViewLen=-1;

// GLSL ramp: the FIELD_RAMP_STOPS table as a chain of mix() calls. For s in
// [k,k+1], the mix calls before k are at full weight and those after are at
// zero, so the chain gives the same six-stop ramp as rampStopRGB.
function glslRamp(){
  const v=c=>`vec3(${c.map(x=>x.toFixed(3)).join(',')})`;
  let src=`vec3 ramp(float t){float s=clamp(t,0.0,1.0)*5.0;vec3 c=${v(FIELD_RAMP_STOPS[0])};`;
  for(let k=1;k<FIELD_RAMP_STOPS.length;k++) src+=`c=mix(c,${v(FIELD_RAMP_STOPS[k])},clamp(s-${(k-1).toFixed(1)},0.0,1.0));`;
  return src+'return c;}';
}
const TR_VS=`
attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aA; attribute vec4 aB; attribute vec4 aN;
uniform vec2 uRes; uniform vec2 uCam; uniform float uZoom; uniform float uDpr;
varying float vDist; varying float vAlong; varying float vGlow; varying float vCore; varying float vFade; varying float vLc;
varying vec2 vDir;
vec2 toScreen(vec2 w){ return (w-0.5*uRes+uCam)*uZoom+0.5*uRes; }
vec2 dirOf(vec2 a,vec2 b,vec2 fb){ vec2 d=b-a; float l=length(d); return l>1e-5?d/l:fb; }
// Miter offset at a joint: the bisector of the two segment normals, scaled so
// the line keeps its width. The scale is clamped on sharp turns.
vec2 miter(vec2 n,vec2 dOther,bool has){
  if(!has) return n;
  vec2 m=normalize(n+vec2(-dOther.y,dOther.x)+1e-6);
  return m/max(dot(m,n),0.5);
}
void main(){
  vDist=0.0; vAlong=0.0; vGlow=0.0; vCore=0.0; vFade=0.0; vLc=0.0; vDir=vec2(1.0,0.0);
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
  float px=uZoom*uDpr;
  float glow=max(1.0,5.0*f)*px, core=max(0.5,1.8*f)*px;
  float halfExt=0.5*max(glow,1.0)+1.0;
  float lcA=aA.z, cap=0.0;
  if(lcA>=2.0){ lcA-=2.0; cap=halfExt/uDpr; }
  float along=mix(-cap,L,aCorner.x);
  vec2 s=sA+dir*along+j*(aCorner.y*halfExt/uDpr);
  gl_Position=vec4(s.x/uRes.x*2.0-1.0,1.0-s.y/uRes.y*2.0,0.0,1.0);
  vDist=aCorner.y*halfExt; vAlong=along*uDpr; vGlow=glow; vCore=core; vFade=f; vLc=mix(lcA,aB.z,aCorner.x); vDir=dir;
}`;
const TR_FS=`
precision mediump float;
varying float vDist; varying float vAlong; varying float vGlow; varying float vCore; varying float vFade; varying float vLc;
varying vec2 vDir;
// uMode: 0 = |B| ramp (the page default), 1 = hue from the direction of B,
// 2 = silver, brightness from |B|. Only the screensaver sets 1 or 2.
uniform float uMode;
${glslRamp()}
float cov(float w,float d){ float we=max(w,1.0); return clamp(0.5*we+0.5-d,0.0,1.0)*(w/we); }
void main(){
  float dx=max(0.0,-vAlong);          // > 0 only inside the head cap
  float d=sqrt(dx*dx+vDist*vDist);
  vec3 col=ramp(vLc);
  if(uMode>0.5&&uMode<1.5){
    float h=atan(vDir.y,vDir.x)/6.2831853+0.5;
    col=clamp(abs(fract(h+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,0.0,1.0)*(0.35+0.75*vLc);
  } else if(uMode>1.5){
    col=vec3(0.80,0.86,0.96)*(0.25+0.9*vLc);
  }
  vec3 c=col*(vFade*(0.12*cov(vGlow,d)+0.55*cov(vCore,d)));
  gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));
}`;

// Make the WebGL context, program and buffers. Returns false if WebGL or
// instancing is not available. Then renderTracers2D() draws the tracers.
function initTracerGL(){
  try{
    const o={alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false};
    gl=glCanvas.getContext('webgl2',o);
    if(gl){
      glInst={div:(l,d)=>gl.vertexAttribDivisor(l,d),draw:(m,f,c,n)=>gl.drawArraysInstanced(m,f,c,n)};
    }else{
      gl=glCanvas.getContext('webgl',o); if(!gl) return false;
      const e=gl.getExtension('ANGLE_instanced_arrays'); if(!e) return false;
      glInst={div:(l,d)=>e.vertexAttribDivisorANGLE(l,d),draw:(m,f,c,n)=>e.drawArraysInstancedANGLE(m,f,c,n)};
    }
    const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const p=gl.createProgram();
    gl.attachShader(p,sh(gl.VERTEX_SHADER,TR_VS)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,TR_FS));
    gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    glLoc={corner:gl.getAttribLocation(p,'aCorner'),P:gl.getAttribLocation(p,'aP'),A:gl.getAttribLocation(p,'aA'),
      B:gl.getAttribLocation(p,'aB'),N:gl.getAttribLocation(p,'aN'),
      res:gl.getUniformLocation(p,'uRes'),cam:gl.getUniformLocation(p,'uCam'),
      zoom:gl.getUniformLocation(p,'uZoom'),dpr:gl.getUniformLocation(p,'uDpr'),
      mode:gl.getUniformLocation(p,'uMode')};
    // Static quad corners: x = 0 at A and 1 at B, y = -1 or +1 across the line.
    const cb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,cb);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,-1,1,-1,0,1,1,1]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(glLoc.corner);
    gl.vertexAttribPointer(glLoc.corner,2,gl.FLOAT,false,0,0); glInst.div(glLoc.corner,0);
    glVBuf=gl.createBuffer();
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE); // additive, as the old 'lighter' strokes
    glCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();glOK=false;});
    return true;
  }catch(err){ console.warn('magnetlab: WebGL tracers off, 2D fallback.',err); return false; }
}
glOK=initTracerGL();

// Fill the vertex buffer: one -1 pad slot, then per tracer the newest
// trailLen points of its ring, newest first, then one -1 slot, then a final
// -1 pad slot. Fade is (1 - s/trailLen) * ageA, as before. Returns the slot
// count without the two pads.
function fillTracerVerts(){
  const TL=SIM.tracerTrail, stride=TL+1, need=(TR_N*stride+2)*4;
  if(glData.length<need) glData=new Float32Array((TR_N*(TRAIL_MAX+1)+2)*4);
  glData[3]=-1;
  let w=4;
  for(let i=0;i<TR_N;i++){
    const age=tAge[i], mx=tMax[i];
    // Age alpha: fast fade-in, slow sustain, fade-out in last 20%
    const ageA = age<0.1 ? age/0.1 : age>mx*0.8 ? (mx-age)/(mx*0.2) : 1;
    const L=trLen[i]<TL?trLen[i]:TL, base=i*TRAIL_MAX;
    let h=trHead[i];
    for(let s=0;s<L;s++){
      const o=base+h;
      glData[w]=trX[o]; glData[w+1]=trY[o]; glData[w+2]=s===0?trC[o]+2:trC[o]; // +2 = head
      glData[w+3]=(1-s/TL)*ageA; w+=4;
      h=h===0?TRAIL_MAX-1:h-1;
    }
    for(let s=L;s<stride;s++){ glData[w+3]=-1; w+=4; }
  }
  glData[w+3]=-1;
  return TR_N*stride;
}

// Draw the tracers into glCanvas. Returns false if WebGL is not in use.
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
  gl.uniform2f(glLoc.res,CW,CH); gl.uniform2f(glLoc.cam,CAM.x,CAM.y);
  gl.uniform1f(glLoc.zoom,CAM.zoom); gl.uniform1f(glLoc.dpr,glCanvas.width/CW);
  gl.uniform1f(glLoc.mode,SIM.trMode);
  glInst.draw(gl.TRIANGLE_STRIP,0,4,slots-1);
  return true;
}

// Tracer layer entry point, called from render() under the camera transform.
// With WebGL, add glCanvas to the 2D canvas in device space. Without WebGL,
// use the 2D bucket path.
function renderTracers(){
  if(renderTracersGL()){
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='lighter';
    ctx.drawImage(glCanvas,0,0);
    ctx.restore();
    return;
  }
  renderTracers2D();
}

// 2D fallback: the older bucket path. Segments quantize into color and fade
// buckets, and each bucket strokes once. The fade steps are visible, but this
// path runs only when WebGL is not available.
const TR_NC=16, TR_NA=10;              // color levels, fade levels
const _trGlowStyle=[], _trCoreStyle=[]; // [fade][color] rgba strings
const _trGlowW=[], _trCoreW=[];         // [fade] line widths
for(let a=0;a<TR_NA;a++){
  const a0=(a+0.5)/TR_NA;
  _trGlowW[a]=Math.max(1,5*a0);
  _trCoreW[a]=Math.max(0.5,1.8*a0);
  _trGlowStyle[a]=[]; _trCoreStyle[a]=[];
  for(let c=0;c<TR_NC;c++){
    const [r,g,b]=rampStopRGB(c/(TR_NC-1));
    _trGlowStyle[a][c]=`rgba(${(r*a0*0.12*255)|0},${(g*a0*0.12*255)|0},${(b*a0*0.12*255)|0},1)`;
    _trCoreStyle[a][c]=`rgba(${(r*a0*0.55*255)|0},${(g*a0*0.55*255)|0},${(b*a0*0.55*255)|0},1)`;
  }
}
const _trPaths=new Array(TR_NC*TR_NA).fill(null);
const _trUsed=[];
function renderTracers2D(){
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  ctx.lineCap='round';
  _trUsed.length=0;
  const slots=fillTracerVerts(), d=glData;
  for(let i=1;i<slots;i++){
    const o=i*4, a0=d[o+3];
    if(a0<0.01||d[o+7]<0) continue;
    let aIdx=(a0*TR_NA)|0; if(aIdx>=TR_NA)aIdx=TR_NA-1;
    const lc=d[o+2]>=2?d[o+2]-2:d[o+2];
    let cIdx=(lc*TR_NC)|0; if(cIdx>=TR_NC)cIdx=TR_NC-1;
    const bi=cIdx*TR_NA+aIdx;
    let p=_trPaths[bi];
    if(!p){ p=_trPaths[bi]=new Path2D(); _trUsed.push(bi); }
    p.moveTo(d[o],d[o+1]); p.lineTo(d[o+4],d[o+5]);
  }
  for(const bi of _trUsed){
    ctx.strokeStyle=_trGlowStyle[bi%TR_NA][(bi/TR_NA)|0]; ctx.lineWidth=_trGlowW[bi%TR_NA];
    ctx.stroke(_trPaths[bi]);
  }
  for(const bi of _trUsed){
    ctx.strokeStyle=_trCoreStyle[bi%TR_NA][(bi/TR_NA)|0]; ctx.lineWidth=_trCoreW[bi%TR_NA];
    ctx.stroke(_trPaths[bi]);
  }
  for(const bi of _trUsed) _trPaths[bi]=null;
  ctx.restore();
}
// Magnet layer: translate and rotate into each body's frame, dispatch to the
// per-type glyph drawer, and ring dynamic magnets with a dashed halo.
function renderMagnets(){
  for(const mag of magnets){
    ctx.save();ctx.translate(mag.x,mag.y);ctx.rotate(mag.angle);
    const sel=mag.id===SIM.selectedId;
    if(mag.type==='bar') drawBar(mag,sel);
    else if(mag.type==='dipole') drawDipole(mag,sel);
    else if(mag.type==='solenoid') drawSolenoid(mag,sel);
    else if(mag.type==='horseshoe') drawHorseshoe(mag,sel);
    else if(mag.type==='buzzer') drawBuzzer(mag,sel);
    else if(mag.type==='ring') drawRing(mag,sel);
    else if(mag.type==='quadrupole') drawQuadrupole(mag,sel);
    else if(mag.type==='halbach') drawHalbach(mag,sel);
    if(!mag.fixed){
      ctx.strokeStyle='rgba(100,200,100,0.45)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.arc(0,0,Math.max(mag.w,mag.h)*0.65,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
  }
}
// Per-type glyph drawers. Each runs in the magnet's local frame (already
// translated and rotated) and paints red for N, blue for S, brighter if
// selected. They draw appearance only; the poles above carry the physics.

// Bar: red N half, blue S half, N/S labels.
function drawBar(m,sel){
  const hw=m.w/2,hh=m.h/2;
  ctx.fillStyle=sel?'rgba(220,60,60,0.85)':'rgba(200,50,50,0.65)';ctx.fillRect(0,-hh,hw,m.h);
  ctx.fillStyle=sel?'rgba(60,100,220,0.85)':'rgba(50,80,200,0.65)';ctx.fillRect(-hw,-hh,hw,m.h);
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.25)';ctx.lineWidth=sel?2:1;ctx.strokeRect(-hw,-hh,m.w,m.h);
  ctx.font='bold 13px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,0.8)';ctx.fillText('N',hw/2,0);ctx.fillText('S',-hw/2,0);
}
// Dipole: a split disc with an arrow showing moment direction.
function drawDipole(m,sel){
  const r=16;
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle=sel?'rgba(150,200,255,0.2)':'rgba(150,200,255,0.08)';ctx.fill();
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.35)';ctx.lineWidth=sel?2:1;ctx.stroke();
  ctx.beginPath();ctx.arc(0,0,r-2,-Math.PI/2,Math.PI/2);ctx.fillStyle='rgba(220,60,60,0.45)';ctx.fill();
  ctx.beginPath();ctx.arc(0,0,r-2,Math.PI/2,Math.PI*1.5);ctx.fillStyle='rgba(60,100,220,0.45)';ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(7,0);ctx.moveTo(4,-3);ctx.lineTo(7,0);ctx.lineTo(4,3);ctx.stroke();
}
// Solenoid: a coil-wound block with vertical winding lines and end labels.
function drawSolenoid(m,sel){
  const hw=m.w/2,hh=m.h/2;
  ctx.fillStyle=sel?'rgba(80,60,40,0.8)':'rgba(60,45,30,0.65)';ctx.fillRect(-hw,-hh,m.w,m.h);
  ctx.strokeStyle='rgba(200,160,60,0.45)';ctx.lineWidth=1.5;
  for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(i*10,-hh);ctx.lineTo(i*10,hh);ctx.stroke();}
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.25)';ctx.lineWidth=sel?2:1;ctx.strokeRect(-hw,-hh,m.w,m.h);
  ctx.font='bold 11px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(220,60,60,0.8)';ctx.fillText('N',hw-10,0);
  ctx.fillStyle='rgba(60,100,220,0.8)';ctx.fillText('S',-hw+10,0);
}
// Horseshoe: two coloured arms joined by a bend, N and S tips at the top.
function drawHorseshoe(m,sel){
  const lc=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.35)';ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(25,-30);ctx.lineTo(25,15);ctx.strokeStyle='rgba(220,80,80,0.65)';ctx.lineWidth=10;ctx.stroke();
  ctx.beginPath();ctx.moveTo(-25,-30);ctx.lineTo(-25,15);ctx.strokeStyle='rgba(80,100,220,0.65)';ctx.lineWidth=10;ctx.stroke();
  ctx.beginPath();ctx.arc(0,15,25,0,Math.PI);ctx.strokeStyle='rgba(140,100,180,0.55)';ctx.lineWidth=10;ctx.stroke();
  ctx.strokeStyle=lc;ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.moveTo(30,-30);ctx.lineTo(30,15);ctx.arc(0,15,30,0,Math.PI);ctx.lineTo(-30,-30);ctx.stroke();
  ctx.beginPath();ctx.moveTo(20,-30);ctx.lineTo(20,15);ctx.arc(0,15,20,0,Math.PI);ctx.lineTo(-20,-30);ctx.stroke();
  ctx.beginPath();ctx.moveTo(20,-30);ctx.lineTo(30,-30);ctx.moveTo(-20,-30);ctx.lineTo(-30,-30);ctx.stroke();
  ctx.font='bold 10px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,200,0.9)';ctx.fillText('N',25,-22);
  ctx.fillStyle='rgba(200,200,255,0.9)';ctx.fillText('S',-25,-22);
}
// Buzzer: a metallic disc split N/S with a centre dot.
function drawBuzzer(m,sel){
  const r=20;
  // Metallic disc body
  const grad=ctx.createRadialGradient(0,0,2,0,0,r);
  grad.addColorStop(0,'rgba(180,180,200,0.4)');grad.addColorStop(0.6,'rgba(120,120,140,0.35)');grad.addColorStop(1,'rgba(80,80,100,0.25)');
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
  // N half (right)
  ctx.beginPath();ctx.arc(0,0,r-2,-Math.PI/2,Math.PI/2);ctx.fillStyle='rgba(220,60,60,0.4)';ctx.fill();
  // S half (left)
  ctx.beginPath();ctx.arc(0,0,r-2,Math.PI/2,Math.PI*1.5);ctx.fillStyle='rgba(60,100,220,0.4)';ctx.fill();
  // Outline + inner ring
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle='rgba(150,200,255,0.12)';ctx.beginPath();ctx.arc(0,0,r*0.55,0,Math.PI*2);ctx.stroke();
  // Center dot
  ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fillStyle='rgba(200,200,220,0.6)';ctx.fill();
  ctx.font='bold 8px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,0.7)';ctx.fillText('N',10,0);ctx.fillText('S',-10,0);
}
// Ring: an annulus with radial ticks marking the outward pole directions.
function drawRing(m,sel){
  const ro=26,ri=14;
  // Ring body with radial gradient
  ctx.beginPath();ctx.arc(0,0,ro,0,Math.PI*2);ctx.arc(0,0,ri,0,Math.PI*2,true);
  ctx.fillStyle=sel?'rgba(100,180,100,0.3)':'rgba(80,150,80,0.2)';ctx.fill();
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.arc(0,0,ro,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(0,0,ri,0,Math.PI*2);ctx.stroke();
  // Pole direction ticks (radial outward arrows)
  ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=1.5;
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    ctx.beginPath();ctx.moveTo(Math.cos(a)*ri,Math.sin(a)*ri);ctx.lineTo(Math.cos(a)*ro,Math.sin(a)*ro);ctx.stroke();
  }
  ctx.font='bold 7px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText('RING',0,0);
}
// Quadrupole: four pole circles on a cross, alternating N and S.
function drawQuadrupole(m,sel){
  const s=22,r=8;
  // Four pole circles at cardinal directions
  const poles=[{x:s,y:0,n:true},{x:0,y:s,n:false},{x:-s,y:0,n:true},{x:0,y:-s,n:false}];
  // Cross body
  ctx.strokeStyle=sel?'rgba(150,200,255,0.5)':'rgba(150,200,255,0.15)';ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.moveTo(-s,0);ctx.lineTo(s,0);ctx.moveTo(0,-s);ctx.lineTo(0,s);ctx.stroke();
  // Pole circles
  for(const p of poles){
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.fillStyle=p.n?'rgba(220,60,60,0.55)':'rgba(60,100,220,0.55)';ctx.fill();
    ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;ctx.stroke();
    ctx.font='bold 9px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(255,255,255,0.8)';ctx.fillText(p.n?'N':'S',p.x,p.y);
  }
  // Center marker
  ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fillStyle='rgba(255,200,50,0.5)';ctx.fill();
}
// Halbach: segmented bar with a rotation arrow per segment showing the 90
// degree step that steers the field to one face.
function drawHalbach(m,sel){
  const hw=m.w/2,hh=m.h/2,ns=6,sw=m.w/ns;
  // Draw segments with arrows showing rotation
  for(let i=0;i<ns;i++){
    const x=-hw+i*sw;
    const a=i*Math.PI/2; // 0°, 90°, 180°, 270°...
    // Segment fill: color indicates pole direction
    const red=Math.max(0,Math.cos(a)), blue=Math.max(0,-Math.cos(a));
    const up=Math.max(0,-Math.sin(a)), dn=Math.max(0,Math.sin(a));
    ctx.fillStyle=`rgba(${(80+red*140)|0},${(40+up*80+dn*80)|0},${(80+blue*140)|0},0.5)`;
    ctx.fillRect(x,-hh,sw,m.h);
    // Arrow showing dipole direction in this segment
    ctx.save();ctx.translate(x+sw/2,0);ctx.rotate(a);
    ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(6,0);ctx.moveTo(3,-3);ctx.lineTo(6,0);ctx.lineTo(3,3);ctx.stroke();
    ctx.restore();
  }
  // Outline
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.25)';ctx.lineWidth=sel?2:1;
  ctx.strokeRect(-hw,-hh,m.w,m.h);
  // Segment dividers
  ctx.strokeStyle='rgba(150,200,255,0.15)';ctx.lineWidth=1;
  for(let i=1;i<ns;i++){const x=-hw+i*sw;ctx.beginPath();ctx.moveTo(x,-hh);ctx.lineTo(x,hh);ctx.stroke();}
  // Label
  ctx.font='bold 8px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,50,0.6)';ctx.fillText('HALBACH',0,hh+8);
}

/* ═══ UI WIRING ═══ */
// Paint a range input's filled portion: set the --pct custom property the CSS
// gradient reads, so the track shows progress up to the thumb.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

// Rebuild the magnet list panel from scratch. One card per magnet carries the
// strength, angle, spin, and fixed/dynamic controls, each wired to setMagProp.
// Called after any add, remove, select, drag, or property change.
function rebuildMagnetList(){
  const list=document.getElementById('mag-list');if(!list)return;list.innerHTML='';
  const names={bar:'Bar',dipole:'Dipole',solenoid:'Solenoid',horseshoe:'Horseshoe',buzzer:'Buzzer',ring:'Ring',quadrupole:'Quadrupole',halbach:'Halbach'};
  magnets.forEach(mag=>{
    const c=document.createElement('div');
    c.className='mag-card'+(mag.id===SIM.selectedId?' selected':'');
    c.onclick=e=>{if(!e.target.closest('.mag-card-del'))selectMagnet(mag.id);};
    c.innerHTML=`<div class="mag-card-head"><span class="mag-card-name">${names[mag.type]||mag.type} ${mag.id}</span><button class="mag-card-del" onclick="removeMagnet(${mag.id})" aria-label="Remove">Remove</button></div>
      <div class="mag-row"><span class="mag-row-lbl">Strength</span><input type="range" min="0.1" max="5" value="${mag.strength}" step="0.1" oninput="setMagProp(${mag.id},'strength',+this.value,this)"><span class="val">${mag.strength.toFixed(1)}</span></div>
      <div class="mag-row"><span class="mag-row-lbl">Angle</span><input type="range" min="-3.14159" max="3.14159" value="${mag.angle}" step="0.05" oninput="setMagProp(${mag.id},'angle',+this.value,this)"><span class="val">${(mag.angle*180/Math.PI).toFixed(0)}°</span></div>
      <div class="mag-row"><span class="mag-row-lbl">Spin</span><input type="range" min="-24" max="24" value="${mag.spin}" step="0.5" oninput="setMagProp(${mag.id},'spin',+this.value,this)"><span class="val">${mag.spin.toFixed(1)}</span></div>
      <button class="tog-btn ${mag.fixed?'off':'on'}" onclick="toggleFixed(${mag.id})">${mag.fixed?'Fixed':'Dynamic'}</button>`;
    list.appendChild(c);
    c.querySelectorAll('input[type=range]').forEach(sg);
  });
  document.getElementById('st-magnets').textContent=magnets.length+' magnet'+(magnets.length!==1?'s':'');
}

// Add a magnet of the given type at a free spot near centre, select it, and
// respawn tracers so filings gather at the new poles.
function addMagnet(type){
  // Find a position that doesn't overlap existing magnets
  let cx=CW/2, cy=CH/2;
  const tryRadius=Math.max(60, Math.min(CW,CH)*0.08);
  let placed=false;
  // Spiral outward from center to find a free spot
  for(let ring=0;ring<8&&!placed;ring++){
    const r=ring*tryRadius;
    const steps=Math.max(1, Math.round(ring*6));
    for(let s=0;s<steps&&!placed;s++){
      const angle=s/steps*Math.PI*2;
      const tx=CW/2+Math.cos(angle)*r;
      const ty=CH/2+Math.sin(angle)*r;
      let overlap=false;
      for(const other of magnets){
        const dx=tx-other.x,dy=ty-other.y;
        const minD=Math.max(other.w,other.h)*0.5+60;
        if(dx*dx+dy*dy<minD*minD){overlap=true;break;}
      }
      if(!overlap){cx=tx;cy=ty;placed=true;}
    }
  }
  cx=Math.max(60,Math.min(CW-60,cx));
  cy=Math.max(60,Math.min(CH-60,cy));
  const m=createMagnet(type,cx,cy);
  magnets.push(m);SIM.selectedId=m.id;
  rebuildMagnetList();spawnTracers();
  // Auto-close mobile panel so user sees the new magnet
  if(window.innerWidth<600) document.getElementById('panel').classList.remove('mob-open');
}

// Slide the left panel in or out on narrow screens.
function toggleMobilePanel(){
  document.getElementById('panel').classList.toggle('mob-open');
}

// The remaining control handlers: remove/select a magnet, edit a property,
// toggle fixed/dynamic, toggle each display layer, retune tracers, and run the
// transport buttons. Each keeps SIM and the DOM in sync, respawning tracers
// where the field geometry changed.
function removeMagnet(id){magnets=magnets.filter(m=>m.id!==id);if(SIM.selectedId===id)SIM.selectedId=magnets.length?magnets[0].id:-1;rebuildMagnetList();spawnTracers();}
function selectMagnet(id){SIM.selectedId=id;rebuildMagnetList();}
function setMagProp(id,prop,val,el){
  const m=magnets.find(m=>m.id===id);if(!m)return;m[prop]=val;if(el)sg(el);
  const row=el.closest('.mag-row');if(row){const v=row.querySelector('.val');if(prop==='angle')v.textContent=(val*180/Math.PI).toFixed(0)+'°';else v.textContent=val.toFixed(1);}
}
function toggleFixed(id){const m=magnets.find(m=>m.id===id);if(!m)return;m.fixed=!m.fixed;m.vx=0;m.vy=0;m.va=0;rebuildMagnetList();}
function toggleTracers(){SIM.showTracers=!SIM.showTracers;const b=document.getElementById('tog-tracers');b.classList.toggle('on',SIM.showTracers);b.classList.toggle('off',!SIM.showTracers);}
function toggleArrows(){SIM.showArrows=!SIM.showArrows;const b=document.getElementById('tog-arrows');b.classList.toggle('on',SIM.showArrows);b.classList.toggle('off',!SIM.showArrows);}
function toggleGrid(){SIM.showHeatmap=!SIM.showHeatmap;const b=document.getElementById('tog-grid');b.classList.toggle('on',SIM.showHeatmap);b.classList.toggle('off',!SIM.showHeatmap);}
function updateTracerCount(el){SIM.tracerCount=+el.value;document.getElementById('vl-tracer-count').textContent=el.value;sg(el);spawnTracers();document.getElementById('st-tracers').textContent=SIM.tracerCount+' tracers';}
function updateTracerSpeed(el){SIM.tracerSpeed=+el.value;document.getElementById('vl-tracer-speed').textContent=(+el.value).toFixed(1);sg(el);}
function updateTracerTrail(el){SIM.tracerTrail=+el.value;document.getElementById('vl-tracer-trail').textContent=el.value;sg(el);}
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'Play':'Pause';b.classList.toggle('active',SIM.playing);}
function resetSim(){magnets.forEach(m=>{m.vx=0;m.vy=0;m.va=0;m.spin=0;});rebuildMagnetList();spawnTracers();}
function stopAll(){magnets.forEach(m=>{m.vx=0;m.vy=0;m.va=0;m.spin=0;});rebuildMagnetList();}
function clearAll(){magnets=[];SIM.selectedId=-1;rebuildMagnetList();spawnTracers();}

/* ═══ DRAG + ZOOM ═══ */
// Input state: which magnet is being dragged, the grab offset, whether Shift
// is rotating it, and whether an empty-space drag is panning the camera.
let dragMag=null,dragOffX=0,dragOffY=0,rotating=false;
let isPanning=false, panLastX=0, panLastY=0;

// Mouse or touch position relative to the canvas, in screen pixels.
function getScreenPos(e){
  const rect=canvas.getBoundingClientRect();
  const t=e.touches?e.touches[0]:e;
  return[t.clientX-rect.left, t.clientY-rect.top];
}
// Same, but mapped through the camera into world coordinates.
function getCanvasPos(e){
  const [sx,sy]=getScreenPos(e);
  return screenToWorld(sx,sy);
}

// Topmost magnet under a world point, tested in each body's local frame against
// its padded bounding box. Iterates back to front so the top magnet wins.
function hitTest(wx,wy){
  for(let i=magnets.length-1;i>=0;i--){
    const m=magnets[i],ca=Math.cos(-m.angle),sa=Math.sin(-m.angle);
    const dx=wx-m.x,dy=wy-m.y,lx=dx*ca-dy*sa,ly=dx*sa+dy*ca;
    if(Math.abs(lx)<m.w/2+10&&Math.abs(ly)<m.h/2+10)return m;
  }
  return null;
}

// ── Wheel zoom (desktop) ──
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const [sx,sy]=getScreenPos(e);
  const [wx,wy]=screenToWorld(sx,sy);
  const factor=e.deltaY<0?1.08:1/1.08;
  CAM.zoom=Math.max(0.15,Math.min(8,CAM.zoom*factor));
  // Keep world point under cursor stationary
  const [wx2,wy2]=screenToWorld(sx,sy);
  CAM.x+=wx2-wx; CAM.y+=wy2-wy;
},{passive:false});

// ── Touch: pinch zoom + pan ──
// Snapshot taken at the start of a two-finger gesture: initial pinch distance,
// zoom, midpoint, and camera offset, so move events can compute deltas.
let pinchDist0=0, pinchZoom0=1, pinchMidX=0, pinchMidY=0, pinchCamX=0, pinchCamY=0;
let touchCount=0;

// Two fingers begin a pinch; one finger falls through to the drag handler.
canvas.addEventListener('touchstart',e=>{
  touchCount=e.touches.length;
  if(touchCount===2){
    e.preventDefault();
    dragMag=null; // cancel any drag
    const t0=e.touches[0],t1=e.touches[1];
    const rect=canvas.getBoundingClientRect();
    const sx0=t0.clientX-rect.left,sy0=t0.clientY-rect.top;
    const sx1=t1.clientX-rect.left,sy1=t1.clientY-rect.top;
    pinchDist0=Math.sqrt((sx1-sx0)**2+(sy1-sy0)**2);
    pinchZoom0=CAM.zoom;
    pinchMidX=(sx0+sx1)/2; pinchMidY=(sy0+sy1)/2;
    pinchCamX=CAM.x; pinchCamY=CAM.y;
    return;
  }
  if(touchCount===1) onDown(e);
},{passive:false});

// Two-finger move: zoom by the distance ratio about the pinch midpoint, then
// pan by how far that midpoint drifted. One finger falls through to onMove.
canvas.addEventListener('touchmove',e=>{
  if(e.touches.length===2){
    e.preventDefault();
    const t0=e.touches[0],t1=e.touches[1];
    const rect=canvas.getBoundingClientRect();
    const sx0=t0.clientX-rect.left,sy0=t0.clientY-rect.top;
    const sx1=t1.clientX-rect.left,sy1=t1.clientY-rect.top;
    const dist=Math.sqrt((sx1-sx0)**2+(sy1-sy0)**2);
    const midX=(sx0+sx1)/2, midY=(sy0+sy1)/2;

    // Zoom
    const [wxOld,wyOld]=screenToWorld(pinchMidX,pinchMidY);
    CAM.zoom=Math.max(0.15,Math.min(8,pinchZoom0*(dist/pinchDist0)));
    const [wxNew,wyNew]=screenToWorld(pinchMidX,pinchMidY);
    CAM.x+=wxNew-wxOld; CAM.y+=wyNew-wyOld;

    // Pan with midpoint drift
    const dmx=(midX-pinchMidX)/CAM.zoom, dmy=(midY-pinchMidY)/CAM.zoom;
    CAM.x=pinchCamX+dmx; CAM.y=pinchCamY+dmy;
    return;
  }
  onMove(e);
},{passive:false});

canvas.addEventListener('touchend',e=>{
  touchCount=e.touches.length;
  if(touchCount===0) onUp();
},{passive:false});

// ── Mouse drag ──
// Press: grab a magnet under the cursor (Shift to rotate it), or start panning
// on empty space.
canvas.addEventListener('mousedown',onDown);
function onDown(e){
  e.preventDefault();const[x,y]=getCanvasPos(e);const hit=hitTest(x,y);
  if(hit){dragMag=hit;dragOffX=hit.x-x;dragOffY=hit.y-y;rotating=e.shiftKey;SIM.selectedId=hit.id;rebuildMagnetList();}
  else{
    // Pan if clicking empty space
    isPanning=true;const[sx,sy]=getScreenPos(e);panLastX=sx;panLastY=sy;
  }
}
// Move: pan the camera, rotate the grabbed magnet toward the cursor, or drag it
// by the stored grab offset.
window.addEventListener('mousemove',onMove);
function onMove(e){
  if(isPanning&&!dragMag){
    const[sx,sy]=getScreenPos(e);
    CAM.x+=(sx-panLastX)/CAM.zoom; CAM.y+=(sy-panLastY)/CAM.zoom;
    panLastX=sx;panLastY=sy;
    return;
  }
  if(!dragMag)return;e.preventDefault();const[x,y]=getCanvasPos(e);
  if(rotating)dragMag.angle=Math.atan2(y-dragMag.y,x-dragMag.x);
  else{dragMag.x=x+dragOffX;dragMag.y=y+dragOffY;}
  rebuildMagnetList();
}
// Release: zero the dropped magnet's velocity so it does not fling off, and
// clear all drag/pan state.
window.addEventListener('mouseup',onUp);
function onUp(){if(dragMag){dragMag.vx=0;dragMag.vy=0;}dragMag=null;rotating=false;isPanning=false;}

/* ═══ RESIZE — uses ResizeObserver on the wrapper div ═══ */
// Match the canvas backing store to the wrapper size times the device pixel
// ratio (capped at 2), and set the transform so drawing stays in CSS pixels.
function resize(){
  const wrap=document.getElementById('canvas-wrap');
  CW=wrap.clientWidth;
  CH=wrap.clientHeight;
  if(CW<10||CH<10){CW=300;CH=300;} // fallback
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=CW*dpr;
  canvas.height=CH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  // The WebGL tracer canvas uses the same backing size.
  glCanvas.width=canvas.width; glCanvas.height=canvas.height;
  document.getElementById('st-dims').textContent=CW+'×'+CH;
}

// Prefer ResizeObserver so the canvas tracks the wrapper through layout changes,
// not just window resizes; fall back to the resize event where it is absent.
// Use ResizeObserver for reliable sizing
if(window.ResizeObserver){
  new ResizeObserver(()=>{resize();spawnTracers();}).observe(document.getElementById('canvas-wrap'));
} else {
  window.addEventListener('resize',()=>{resize();spawnTracers();});
}

/* ═══ LOOP ═══ */
// Frame driver: measure dt (clamped so a stalled tab cannot jump the physics),
// step the simulation when playing, refresh the status readouts, and render.
// The pole cache refreshes after the magnets move and before any field use.
let lastTime=0,fpsCounter=0,fpsTime=0,rafId=0;
const stFps=document.getElementById('st-fps'), stField=document.getElementById('st-field'), stZoom=document.getElementById('st-zoom');
function loop(time){
  rafId=requestAnimationFrame(loop);
  const dt=Math.max(0,Math.min((time-lastTime)/1000,0.05));lastTime=time;
  fpsCounter++;fpsTime+=dt;
  if(fpsTime>=0.5){stFps.textContent=Math.round(fpsCounter/fpsTime)+' fps';fpsCounter=0;fpsTime=0;}
  if(saverOn) saverStep(dt);
  if(SIM.playing) integrateMagnets();
  refreshFrameCache();
  if(SIM.playing) updateTracers(dt);
  if(magnets.length>0){
    fieldAt(CW/2,CH/2);
    stField.textContent='B: '+Math.sqrt(FBx*FBx+FBy*FBy).toExponential(1);
  }
  stZoom.textContent=CAM.zoom.toFixed(1)+'×';
  render();
  if(saverOn) saverOverlay();
}

// Stop the loop while the page is hidden. The browser already stops rAF in a
// hidden tab. This also makes sure that no step runs on return with a long dt.
// On return, reset lastTime so the first dt is near zero.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ if(rafId){cancelAnimationFrame(rafId);rafId=0;} }
  else if(!rafId && started){ lastTime=performance.now(); rafId=requestAnimationFrame(loop); }
});

/* ═══ INIT ═══ */
// Paint the fixed panel sliders once, then start after a short delay so the
// wrapper has a measured size. Init sizes the canvas, spawns tracers, builds
// the list, drops one bar magnet, and kicks off the loop.
document.querySelectorAll('#panel input[type=range]').forEach(sg);
// Delay init slightly to ensure layout is computed
let started=false;
setTimeout(()=>{
  resize();
  // Set the default streamer count from the canvas size (see tracerBudget).
  const sl=document.getElementById('sl-tracer-count');
  sl.value=tracerBudget(); updateTracerCount(sl);
  rebuildMagnetList();
  addMagnet('bar');
  started=true; lastTime=performance.now();
  if(!document.hidden) rafId=requestAnimationFrame(loop);
},50);


/* ═══ SCREENSAVER ═══ */
// Hook for the shell screensaver (lib/screensaver.js). enter() hides the panel,
// status bar, equation card and overlays, so #canvas-wrap fills the window and
// resize() sizes the canvas to it. The saver then plays a tour of magnet
// configurations (SAVER_SCENES) in a seeded order. Each scene builds its own
// fixed magnets, moves them in saverStep() on smooth paths, and picks a view:
// field lines coloured by |B|, by the direction of B, silver lines, a heat map
// under the lines, or an iron-filings layer. A scene change fades through
// black (saverOverlay). Each scene sends opts.label its field equation and its
// live parameters. opts.calm (1 = slowest) scales every rate.
//
//   grep -n targets: "const SAVER_SCENES", "function saverStep",
//   "function saverScene", "function renderFilings", "window.snSaver"
let saverOn=false;
const SV={opts:null,order:[],k:0,t:0,dwell:20,slow:1,scene:null,st:null,fade:1,cx:0,cy:0,R:200};
const FADE_S=1.4;
const deg=a=>Math.round(a*180/Math.PI);
const fx=(v,n=2)=>(+v).toFixed(n);
// An angular rate as the viewer sees it: scene time runs at SV.slow.
const om=w=>fx(w*SV.slow,3);

// Small builders. A saver magnet is fixed, so the collision code does not move
// it, and saverStep() owns its position and angle.
function svMag(type,x,y,angle,strength){
  const m=createMagnet(type,x,y); m.angle=angle; m.fixed=true;
  if(strength!=null) m.strength=strength; return m;
}
// One dipole of a ring or an array: a 'dipole' body with its moment along angle.
const svDip=(x,y,a,s)=>svMag('dipole',x,y,a,s??1.4);

// View presets. trMode is the tracer colour mode in TR_FS.
const VIEWS={
  mag:   {name:'field lines, colour = |B| (log scale)',     tr:true, mode:0, heat:false, fil:false},
  dir:   {name:'field lines, hue = direction of B',          tr:true, mode:1, heat:false, fil:false},
  silver:{name:'field lines, brightness = |B|',              tr:true, mode:2, heat:false, fil:false},
  heat:  {name:'heat map of |B| under the field lines',      tr:true, mode:2, heat:true,  fil:false},
  filings:{name:'iron filings: each one turns until τ = m × B = 0', tr:false, mode:0, heat:false, fil:true},
};
const DIPOLE_EQ='B(r) = (μ₀/4π)·[3(m·r̂)r̂ − m] / r³';
const SUM_EQ='B = Σᵢ (μ₀/4π)·[3(mᵢ·r̂ᵢ)r̂ᵢ − mᵢ] / rᵢ³';

// The scenes. build(st) puts the magnets in `magnets` and fills st. step(st,t)
// moves them; t is the scene time in seconds, already scaled by calm. label(st)
// gives the plate. views lists the views a scene can take (seeded choice).
const SAVER_SCENES=[
  { id:'dipole', views:['mag','filings','dir'],
    build(st){ st.w=0.22; magnets=[svMag('bar',SV.cx,SV.cy,0,1.2)]; },
    step(st,t){ magnets[0].angle=st.w*t; },
    label:st=>({title:'A single bar magnet', sub:'magnetic dipole',
      eq:[DIPOLE_EQ,'|B| ∝ 1/r³ far from the magnet'],
      lines:['axis angle '+((deg(magnets[0].angle)%360+360)%360)+'°, turning at ω = '+om(st.w)+' rad/s']}) },

  { id:'attract', views:['mag','filings','silver'],
    build(st){ st.d0=SV.R*0.55; st.a=SV.R*0.18; st.w=0.35; st.rot=0.05;
      magnets=[svMag('bar',0,0,0,1.2),svMag('bar',0,0,0,1.2)]; },
    step(st,t){ const d=st.d0+st.a*Math.sin(st.w*t), a=st.rot*t, c=Math.cos(a), s=Math.sin(a);
      st.d=d; magnets[0].x=SV.cx-c*d/2; magnets[0].y=SV.cy-s*d/2; magnets[1].x=SV.cx+c*d/2; magnets[1].y=SV.cy+s*d/2;
      magnets[0].angle=a; magnets[1].angle=a; },
    label:st=>({title:'Two magnets, N facing S', sub:'attracting pair',
      eq:['F = 3μ₀ m₁m₂ / (2π d⁴)   (coaxial dipoles)','U = −m·B,  F = ∇(m·B)'],
      lines:['the field lines run across the gap','gap d breathes '+Math.round(st.d0-st.a)+'–'+Math.round(st.d0+st.a)+' px at ω = '+om(st.w)+' rad/s']}) },

  { id:'repel', views:['mag','dir','filings'],
    build(st){ st.d0=SV.R*0.6; st.a=SV.R*0.18; st.w=0.3; st.rot=-0.05;
      magnets=[svMag('bar',0,0,0,1.2),svMag('bar',0,0,Math.PI,1.2)]; },
    step(st,t){ const d=st.d0+st.a*Math.sin(st.w*t), a=st.rot*t, c=Math.cos(a), s=Math.sin(a);
      magnets[0].x=SV.cx-c*d/2; magnets[0].y=SV.cy-s*d/2; magnets[1].x=SV.cx+c*d/2; magnets[1].y=SV.cy+s*d/2;
      magnets[0].angle=a; magnets[1].angle=a+Math.PI; },
    label:st=>({title:'Two magnets, N facing N', sub:'repelling pair',
      eq:['F = 3μ₀ m₁m₂ / (2π d⁴), pushing apart','B = 0 at the null point between the poles'],
      lines:['the lines turn away from the gap','gap d breathes '+Math.round(st.d0-st.a)+'–'+Math.round(st.d0+st.a)+' px at ω = '+om(st.w)+' rad/s']}) },

  { id:'quad', views:['mag','dir','heat'],
    build(st){ st.r=SV.R*0.55; st.w=0.07; magnets=[0,1,2,3].map(()=>svMag('bar',0,0,0,1.3)); },
    step(st,t){ for(let i=0;i<4;i++){ const p=Math.PI/4+i*Math.PI/2+st.w*t, m=magnets[i];
      m.x=SV.cx+Math.cos(p)*st.r; m.y=SV.cy+Math.sin(p)*st.r; m.angle=p+(i%2?Math.PI:0); } },
    label:st=>({title:'Quadrupole lens', sub:'four magnets, poles N S N S',
      eq:['Bx = G·y,   By = G·x','|B| = G·r   (zero on the axis)'],
      lines:['bore radius '+Math.round(st.r)+' px','the lens turns at ω = '+om(st.w)+' rad/s','used to focus beams in accelerators']}) },

  { id:'halbach-ring', views:['mag','dir','heat','silver'],
    build(st){ const ks=[2,2,3,-2]; st.k=ks[SV.pick(ks.length)]; st.n=12; st.r=SV.R*0.62; st.w=0.05;
      magnets=[]; for(let i=0;i<st.n;i++) magnets.push(svDip(0,0,0,1.6)); },
    step(st,t){ const sp=st.w*t; for(let i=0;i<st.n;i++){ const th=i/st.n*2*Math.PI, m=magnets[i];
      m.x=SV.cx+Math.cos(th+sp)*st.r; m.y=SV.cy+Math.sin(th+sp)*st.r; m.angle=st.k*th+sp; } },
    label:st=>({title:'Halbach cylinder, k = '+st.k, sub:st.n+' dipoles on a ring',
      eq:['m̂(θ) = (cos kθ, sin kθ)','B in the bore ∝ r^(k−2)'],
      lines:[st.k===2?'k = 2: near-uniform field in the bore, weak outside'
            :st.k===3?'k = 3: quadrupole in the bore, B = 0 at the centre'
            :'k = −2: the flux goes outside, the bore is near zero',
        'ring radius '+Math.round(st.r)+' px, turning at ω = '+om(st.w)+' rad/s']}) },

  { id:'halbach-line', views:['mag','silver','filings'],
    build(st){ st.n=12; st.gap=Math.min(46,CW*0.9/st.n); st.w=0.09;
      magnets=[]; for(let i=0;i<st.n;i++) magnets.push(svDip(0,0,0,1.6)); },
    step(st,t){ const a=0.25*Math.sin(st.w*t), c=Math.cos(a), s=Math.sin(a);
      for(let i=0;i<st.n;i++){ const u=(i-(st.n-1)/2)*st.gap, m=magnets[i];
        m.x=SV.cx+c*u; m.y=SV.cy+s*u; m.angle=a+i*Math.PI/2; } },
    label:st=>({title:'Linear Halbach array', sub:st.n+' dipoles, each turned 90°',
      eq:['m̂(x) = (cos kx, sin kx),  k = 2π/λ','B ∝ e^(−k|y|) on the strong face'],
      lines:['strong face below the array, weak face above','λ = '+Math.round(st.gap*4)+' px, rocking ±14°']}) },

  { id:'orbit', views:['mag','dir','silver'],
    build(st){ st.R=SV.R*0.62; st.w=0.25; magnets=[svMag('solenoid',SV.cx,SV.cy,0,1.4),svMag('buzzer',0,0,0,1.2)]; },
    step(st,t){ const p=st.w*t, m=magnets[1]; m.x=SV.cx+Math.cos(p)*st.R; m.y=SV.cy+Math.sin(p)*st.R; m.angle=p+Math.PI/2;
      magnets[0].angle=0.15*Math.sin(0.11*t); },
    label:st=>({title:'A magnet orbiting a coil', sub:'solenoid + disc magnet',
      eq:['B = μ₀ n I   (inside a long solenoid)','x = R cos ωt,  y = R sin ωt'],
      lines:['R = '+Math.round(st.R)+' px, ω = '+om(st.w)+' rad/s, period '+fx(2*Math.PI/(st.w*SV.slow),1)+' s','the disc moment stays along the orbit']}) },

  { id:'lattice', views:['dir','mag','filings'],
    build(st){ st.nx=CW>CH?5:3; st.ny=CW>CH?3:5; st.sp=Math.min(CW/(st.nx+0.6),CH/(st.ny+0.6)); st.w=[];
      magnets=[]; for(let j=0;j<st.ny;j++)for(let i=0;i<st.nx;i++){
        magnets.push(svDip(0,0,0,1.5)); st.w.push(((i+j)%2?-1:1)*(0.12+0.05*((i*3+j)%4))); } },
    step(st,t){ let q=0; for(let j=0;j<st.ny;j++)for(let i=0;i<st.nx;i++){ const m=magnets[q];
      m.x=SV.cx+(i-(st.nx-1)/2)*st.sp; m.y=SV.cy+(j-(st.ny-1)/2)*st.sp; m.angle=st.w[q]*t+(i+j)*0.7; q++; } },
    label:st=>({title:'Lattice of turning dipoles', sub:st.nx+' × '+st.ny+' grid, neighbours counter-rotate',
      eq:[SUM_EQ,'θᵢ(t) = θᵢ₀ + ωᵢ t'],
      lines:['ωᵢ from '+om(Math.min(...st.w.map(Math.abs)))+' to '+om(Math.max(...st.w.map(Math.abs)))+' rad/s','spacing '+Math.round(st.sp)+' px']}) },

  { id:'horseshoe', views:['filings','mag','heat'],
    build(st){ st.w=0.12; st.d=Math.max(95,SV.R*0.28); magnets=[svMag('horseshoe',SV.cx,SV.cy,0,1.4),svMag('bar',0,0,0,0.9)]; },
    step(st,t){ const a=0.5*Math.sin(st.w*t), hs=magnets[0], b=magnets[1];
      hs.angle=a; b.x=SV.cx+Math.sin(a)*st.d; b.y=SV.cy-Math.cos(a)*st.d;
      b.angle=a+Math.PI/2+0.6*Math.sin(st.w*1.7*t); },
    label:st=>({title:'Horseshoe and a free bar', sub:'flux crosses the gap',
      eq:[SUM_EQ,'∇·B = 0: each line from N comes back to S'],
      lines:['the bar '+Math.round(st.d)+' px above the gap turns ±34°','the horseshoe rocks ±29°']}) },
];

// Seeded random 0..1 (mulberry32), so a seed gives the same tour.
function svRand(seed){ let a=seed>>>0; return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^t>>>15,t|1);
  t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }

// Start scene number k of the tour: new magnets, a seeded view, fresh tracers,
// filings seeds and the plate.
function saverScene(k){
  SV.k=k; SV.t=0;
  const sc=SAVER_SCENES[SV.order[k%SV.order.length]];
  SV.cx=CW*(CW>CH*1.2?0.44:0.5); SV.cy=CH*0.5; SV.R=Math.min(CW,CH)*0.5;
  const st={}; SV.scene=sc; SV.st=st; sc.build(st);
  for(const m of magnets){ m.spin=0; m.vx=m.vy=m.va=0; }
  sc.step(st,0);
  const v=VIEWS[sc.views[SV.pick(sc.views.length)]]; st.view=v;
  SIM.showTracers=v.tr; SIM.trMode=v.mode; SIM.showHeatmap=v.heat; SIM.showFilings=v.fil; SIM.showArrows=false;
  SIM.tracerCount=v.tr?tracerBudget():0;
  CAM.x=0; CAM.y=0; CAM.zoom=1;
  spawnTracers(); seedFilings();
  const L=sc.label(st); L.lines=(L.lines||[]).concat(['view: '+v.name]);
  if(SV.opts && SV.opts.label) SV.opts.label(L);
}

// Per frame, before integrateMagnets(): move the scene, and fade through
// black around a scene change. SV.fade is the black cover, 0..1.
function saverStep(dt){
  SV.t+=dt;
  if(SV.st) SV.scene.step(SV.st,SV.t*SV.slow);
  const left=SV.dwell-SV.t;
  if(left<=0){ saverScene(SV.k+1); SV.fade=1; return; }
  SV.fade=Math.max(0,Math.min(1,Math.max(1-SV.t/FADE_S,1-left/FADE_S)));
}
function saverOverlay(){
  if(SV.fade<=0.002) return;
  ctx.fillStyle='rgba(14,17,24,'+SV.fade.toFixed(3)+')'; ctx.fillRect(0,0,CW,CH);
}

// Iron filings: short silver dashes on a jittered grid, each laid along B̂.
// Brightness follows |B| in four buckets, so a frame strokes four paths.
let filX=new Float32Array(0), filY=new Float32Array(0), filN=0;
function seedFilings(){
  if(!SIM.showFilings){ filN=0; return; }
  const g=Math.max(8,Math.sqrt(CW*CH/11000)), nx=Math.ceil(CW/g), ny=Math.ceil(CH/g);
  filN=nx*ny; filX=new Float32Array(filN); filY=new Float32Array(filN);
  let q=0; for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ filX[q]=(i+Math.random())*g; filY[q]=(j+Math.random())*g; q++; }
}
const _filP=[null,null,null,null];
function renderFilings(){
  for(let b=0;b<4;b++) _filP[b]=new Path2D();
  const h=Math.max(3,Math.sqrt(CW*CH/11000)*0.42);
  for(let q=0;q<filN;q++){
    const x=filX[q], y=filY[q];
    if(isInsideMagnet(x,y)) continue;
    fieldAt(x,y); const B=Math.hypot(FBx,FBy); if(B<1e-9) continue;
    const lv=fieldLevel(B); if(lv<0.02) continue;
    const ux=FBx/B*h, uy=FBy/B*h, p=_filP[Math.min(3,(lv*4)|0)];
    p.moveTo(x-ux,y-uy); p.lineTo(x+ux,y+uy);
  }
  ctx.save(); ctx.lineCap='round'; ctx.lineWidth=1.3;
  for(let b=0;b<4;b++){ ctx.strokeStyle='rgba(205,215,235,'+(0.22+0.22*b)+')'; ctx.stroke(_filP[b]); }
  ctx.restore();
}

window.snSaver={
  enter(opts){
    const calm=Math.min(1,Math.max(0,opts.calm??0.7));
    const st=document.createElement('style');
    st.textContent='#panel,#mob-btn,#eq-panel,#status-bar{display:none!important}'+
      '#canvas-wrap{position:fixed!important;inset:0}body::before,body::after{display:none}';
    document.head.appendChild(st);
    const ready=()=>started?Promise.resolve():new Promise(r=>setTimeout(()=>r(ready()),60));
    return ready().then(()=>{
      resize();
      const rnd=svRand(opts.seed||1);
      SV.opts=opts; SV.pick=n=>Math.floor(rnd()*n)%n;
      SV.order=SAVER_SCENES.map((_,i)=>i);
      for(let i=SV.order.length-1;i>0;i--){ const j=SV.pick(i+1); [SV.order[i],SV.order[j]]=[SV.order[j],SV.order[i]]; }
      SV.slow=1-0.7*calm;
      SV.dwell=Math.max(14,Math.min(30,(opts.seconds||60)/3));
      SIM.selectedId=-1; SIM.playing=true;
      SIM.tracerSpeed=0.6+0.6*SV.slow; SIM.tracerTrail=60;
      saverOn=true;
      saverScene(0); SV.fade=0;
      rebuildMagnetList();
      return { canvas, warmupMs:1500 };
    });
  },
  exit(){ saverOn=false; if(SV.opts&&SV.opts.label) SV.opts.label(null); }
};
