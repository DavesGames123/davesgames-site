// ============================================================================
//  MAGNETLAB  ·  drag, pan and zoom  (part 13 of 20)
// ----------------------------------------------------------------------------
//  Mouse and touch input on the canvas: magnet drag and Shift rotate,
//  empty-space pan, wheel zoom and two-finger pinch.
//
//  grep -n targets: "let dragMag", "function hitTest", "Wheel zoom", "Touch: pinch",
//                   "function onDown", "function onMove", "function onUp"
// ============================================================================

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
