// ============================================================================
//  MAGNETLAB  ·  tracer 2D fallback  (part 10 of 20)
// ----------------------------------------------------------------------------
//  The bucket path for the tracers when WebGL is not available. It reads
//  the same vertex fill as the WebGL path.
//
//  grep -n targets: "const TR_NC", "function renderTracers2D"
// ============================================================================

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
