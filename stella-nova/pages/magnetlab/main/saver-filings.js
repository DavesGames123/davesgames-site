// ============================================================================
//  MAGNETLAB  ·  iron filings layer  (part 18 of 20)
// ----------------------------------------------------------------------------
//  The saver-only iron-filings layer. render() draws it when
//  SIM.showFilings is on.
//
//  grep -n targets: "function seedFilings", "function renderFilings"
// ============================================================================

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
