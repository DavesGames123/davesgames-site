// ============================================================================
//  MAGNETLAB  ·  frame draw  (part 7 of 20)
// ----------------------------------------------------------------------------
//  render() clears, applies the camera, draws the grid, then each enabled
//  layer: heatmap, filings, arrows, tracers, magnets. The heatmap and
//  arrow layers are here. The other layers are in their own parts.
//
//  grep -n targets: "function render", "function renderHeatmap", "function renderArrows"
// ============================================================================

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
