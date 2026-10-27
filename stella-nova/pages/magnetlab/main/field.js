// ============================================================================
//  MAGNETLAB  ·  field sum and pole cache  (part 3 of 20)
// ----------------------------------------------------------------------------
//  The point-dipole field of one pole, the per-frame pole cache, and the
//  two field sums: fieldAt() from the cache, fieldFromOthers() for forces.
//
//  grep -n targets: "const FIELD_SCALE", "function dipoleField", "function refreshFrameCache",
//                   "function fieldAt", "function fieldFromOthers"
// ============================================================================

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
