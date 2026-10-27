// ============================================================================
//  MAGNETLAB  ·  tracer particles  (part 5 of 20)
// ----------------------------------------------------------------------------
//  The iron-filing tracers: typed-array trail rings, the streamer budget,
//  spawn near pole tips, the inside-magnet test, and the per-frame step.
//
//  grep -n targets: "const TRAIL_MAX", "function tracerBudget", "function fieldLevel",
//                   "function spawnPos", "function isInsideMagnet", "function spawnTracers",
//                   "function updateTracers"
// ============================================================================

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
