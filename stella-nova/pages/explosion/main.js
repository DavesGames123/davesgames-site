// ============================================================================
//  EXPLOSION VIEWER  ·  WebGPU volumetric explosion with an animation dope sheet
// ----------------------------------------------------------------------------
//  A classic (non-module) script. It drives one WebGPU render pass whose
//  fragment shader (shaders/explosion.wgsl) ray-marches a fireball. Three
//  editable animation curves — scale, brightness, density — are sampled at the
//  current playback time and pushed into shader uniforms every frame. The dope
//  sheet is a 2D canvas the user edits by dragging control points.
//
//  PIPELINE
//  --------
//      dope-sheet curves ─ evalCurve(t) ─┐
//      transport (time, seed, zoom) ─────┤
//      mouse drag (rotate) ──────────────┼─▶ Float32Array ud ─▶ uniformBuf
//                                         │        │
//                                         │        ▼
//                            noise texture├──▶ bind group ─▶ render pipeline
//                                         │        │  (full-screen triangle)
//                                         ▼        ▼
//                              dsCv (dope sheet)  cv <canvas webgpu>
//
//  FRAME LOOP  (function frame)
//      advance currentTime ─▶ sample 3 curves ─▶ write uniforms ─▶ draw(3)
//      also: redraw dope sheet, update FPS/time readouts, resize canvas
//
//  SECTION MAP  (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      debug overlay ........ "var dbgEl"            on-screen error log
//      curves ............... "var CURVES"           the 3 animated params
//      defaults ............. "function defaultCurves"  seed the curve shapes
//      interpolation ........ "function evalCurve"   Catmull-Rom sampling
//      curve → value ........ "function getCurveValue"  map [0,1] to real range
//      state ................ "var playing"          playback / view state
//      UI wiring ............ "var btnPlay"          transport + key bindings
//      dope sheet draw ...... "function drawDopeSheet"  render the curve editor
//      dope sheet hit ....... "function dsHitTest"   pick the nearest point
//      dope sheet edit ...... "dsCv.addEventListener" add / drag / remove points
//      noise texture ........ "function makeNoiseTex"  LCG-filled 256x256 RGBA
//      WebGPU init .......... "navigator.gpu"        device, pipeline, bind group
//      frame loop ........... "function frame"       per-frame update + draw
// ============================================================================

// On-screen debug log: any error or WGSL compile message is appended here so
// failures are visible without the devtools console.
var dbgEl=document.getElementById('dbg');
function dbg(s){dbgEl.style.display='block';dbgEl.textContent+=s+'\n';}
window.onerror=function(m,s,l,c,e){dbg('ERR:'+m+' @'+l+':'+c+(e?'\n'+e.stack:''));};
window.addEventListener('unhandledrejection',function(e){dbg('REJ:'+(e.reason?.stack||e.reason));});

// ═══════════════════════════════════════════════════════════
// Curves — each has points [{t, v}] normalized: t in [0,1], v in [0,1]
// ═══════════════════════════════════════════════════════════
// The three editable animation channels. Each holds normalized control points
// plus the real-world [min,max] its 0..1 value maps onto, a colour, and a
// visibility flag for the dope-sheet legend.
var CURVES = {
  scale:   { color:'#ffc832', visible:true, label:'Scale',   min:0.02, max:0.55, points:[] },
  bright:  { color:'#96c8ff', visible:true, label:'Bright',  min:0.2,  max:4.0,  points:[] },
  density: { color:'#64c864', visible:true, label:'Density', min:0.2,  max:3.0,  points:[] },
};

// Load the three curves with their default keyframe shapes: a quick expanding
// scale, a hot-then-dimming brightness, and a density that builds and settles.
function defaultCurves() {
  // Scale: fast rise then plateau — ease-out
  CURVES.scale.points = [
    {t:0, v:0.02}, {t:0.03, v:0.35}, {t:0.08, v:0.65}, {t:0.2, v:0.85}, {t:0.5, v:0.95}, {t:1, v:1}
  ];
  // Brightness: hot start, gradual dim
  CURVES.bright.points = [
    {t:0, v:1}, {t:0.05, v:0.9}, {t:0.15, v:0.6}, {t:0.4, v:0.4}, {t:0.7, v:0.35}, {t:1, v:0.3}
  ];
  // Density: builds up then stays
  CURVES.density.points = [
    {t:0, v:0.3}, {t:0.05, v:0.45}, {t:0.15, v:0.6}, {t:0.4, v:0.7}, {t:1, v:0.5}
  ];
}
defaultCurves();

// Sample a curve at normalized time tNorm. Endpoints clamp; interior segments
// use a Catmull-Rom spline through the four surrounding points so the drawn
// curve passes smoothly through every control point. Result clamped to [0,1].
// Catmull-Rom interpolation
function evalCurve(pts, tNorm) {
  if (pts.length === 0) return 0.5;
  if (pts.length === 1) return pts[0].v;
  if (tNorm <= pts[0].t) return pts[0].v;
  if (tNorm >= pts[pts.length-1].t) return pts[pts.length-1].v;
  // Find segment
  // Locate the segment [i, i+1] that contains tNorm.
  var i = 0;
  for (i = 0; i < pts.length-1; i++) { if (tNorm < pts[i+1].t) break; }
  var p0 = pts[Math.max(0, i-1)];
  var p1 = pts[i];
  var p2 = pts[i+1];
  var p3 = pts[Math.min(pts.length-1, i+2)];
  var seg = p2.t - p1.t;
  if (seg < 0.0001) return p1.v;
  var u = (tNorm - p1.t) / seg;
  var u2 = u*u, u3 = u2*u;
  // Catmull-Rom
  var v = 0.5 * (
    (2*p1.v) +
    (-p0.v + p2.v) * u +
    (2*p0.v - 5*p1.v + 4*p2.v - p3.v) * u2 +
    (-p0.v + 3*p1.v - 3*p2.v + p3.v) * u3
  );
  return Math.max(0, Math.min(1, v));
}

// Sample a named curve and remap its 0..1 output into that curve's real range.
function getCurveValue(name, tNorm) {
  var c = CURVES[name];
  var v = evalCurve(c.points, tNorm);
  return c.min + v * (c.max - c.min);
}

// ═══════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════
// Playback and view state. currentTime scrubs the 8-second timeline; seed
// reshuffles the explosion; mouseX is the drag-driven view rotation; the
// scrubbing/dragging flags mark which interaction owns the pointer.
var playing=true, speed=1, zoom=0.5, quality=2;
var currentTime=0, duration=8;
var seed=Math.random()*1000;
var lastTs=0, frames=0, fpsTime=0;
var mouseX=200, dragging=false, dragSX=0, mxS=0;
var scrubbing=false;
var FDT=1/60;
document.getElementById('seedLabel').textContent=seed.toFixed(1);

// ═══════════════════════════════════════════════════════════
// UI wiring
// ═══════════════════════════════════════════════════════════
var btnPlay=document.getElementById('btnPlay');
var tlFill=document.getElementById('tlFill');
var timeline=document.getElementById('timeline');
var cv=document.getElementById('cv');
// Sync the play/pause glyph to the playing flag.
function updPlayBtn(){btnPlay.textContent=playing?'⏸':'▶';}
// Transport buttons: play/pause, single-frame step, and reseed-to-start.
btnPlay.addEventListener('click',function(){playing=!playing;updPlayBtn();});
document.getElementById('btnFrameBack').addEventListener('click',function(){playing=false;currentTime=Math.max(0,currentTime-FDT);updPlayBtn();});
document.getElementById('btnFrameFwd').addEventListener('click',function(){playing=false;currentTime=Math.min(duration,currentTime+FDT);updPlayBtn();});
document.getElementById('btnSeed').addEventListener('click',function(){seed=Math.floor(Math.random()*10000)/10;currentTime=0;document.getElementById('seedLabel').textContent=seed.toFixed(1);});
document.querySelectorAll('[data-spd]').forEach(function(b){b.addEventListener('click',function(){speed=parseFloat(this.dataset.spd);document.querySelectorAll('[data-spd]').forEach(function(x){x.classList.remove('active');});this.classList.add('active');});});
document.querySelectorAll('[data-q]').forEach(function(b){b.addEventListener('click',function(){quality=parseInt(this.dataset.q);document.querySelectorAll('[data-q]').forEach(function(x){x.classList.remove('active');});this.classList.add('active');});});
document.getElementById('sldZoom').addEventListener('input',function(){zoom=+this.value;document.getElementById('valZoom').textContent=zoom.toFixed(2);});
// Map a pointer x within the timeline track to a time in seconds (16px insets).
function timeFromMouse(e){var r=timeline.getBoundingClientRect();return Math.max(0,Math.min(1,(e.clientX-r.left-16)/(r.width-32)))*duration;}
// Timeline scrubbing: press-and-drag anywhere on the track sets currentTime.
timeline.addEventListener('mousedown',function(e){scrubbing=true;currentTime=timeFromMouse(e);});
document.addEventListener('mousemove',function(e){if(scrubbing)currentTime=timeFromMouse(e);});
document.addEventListener('mouseup',function(){scrubbing=false;});
// Canvas drag rotates the view: track the press point and accumulate mouseX.
cv.addEventListener('mousedown',function(e){dragging=true;dragSX=e.clientX;mxS=mouseX;e.preventDefault();});
document.addEventListener('mousemove',function(e){if(dragging)mouseX=mxS+(e.clientX-dragSX)*0.5;});
document.addEventListener('mouseup',function(){dragging=false;});
// Scroll wheel dollies the camera (zoom), clamped to [0,3].
cv.addEventListener('wheel',function(e){e.preventDefault();zoom=Math.max(0,Math.min(3,zoom+(e.deltaY>0?-0.1:0.1)));document.getElementById('sldZoom').value=zoom;document.getElementById('valZoom').textContent=zoom.toFixed(2);},{passive:false});
// Keyboard shortcuts: space play/pause, arrows scrub, comma/period step, N reseed.
document.addEventListener('keydown',function(e){
  if(e.code==='Space'){e.preventDefault();playing=!playing;updPlayBtn();}
  if(e.code==='ArrowLeft')currentTime=Math.max(0,currentTime-0.5);
  if(e.code==='ArrowRight')currentTime=Math.min(duration,currentTime+0.5);
  if(e.code==='Comma'){playing=false;currentTime=Math.max(0,currentTime-FDT);updPlayBtn();}
  if(e.code==='Period'){playing=false;currentTime=Math.min(duration,currentTime+FDT);updPlayBtn();}
  if(e.code==='KeyN')document.getElementById('btnSeed').click();
});

// Legend toggles: clicking a legend entry shows/hides that curve and redraws.
// Legend toggles
document.querySelectorAll('.ds-leg-item').forEach(function(el){
  el.addEventListener('click',function(){
    var name=this.dataset.curve;
    CURVES[name].visible=!CURVES[name].visible;
    this.classList.toggle('on',CURVES[name].visible);
    drawDopeSheet();
  });
});
document.getElementById('btnResetCurves').addEventListener('click',function(){defaultCurves();drawDopeSheet();});

// ═══════════════════════════════════════════════════════════
// Dope Sheet Canvas
// ═══════════════════════════════════════════════════════════
// The dope sheet is a 2D canvas overlay. DS_H is its fixed height; DS_PAD is
// the inner margin that leaves room for axis labels; dsDragging/dsHover track
// which control point the pointer is moving or over.
var dsCv=document.getElementById('dsCv');
var dsCtx=dsCv.getContext('2d');
var DS_H=180;
var DS_PAD={l:50, r:16, t:16, b:24};
var dsDragging=null; // {curve, idx}
var dsHover=null;

// Size the dope-sheet canvas backing store to the device pixel ratio so lines
// stay crisp, then scale the 2D context so drawing code can use CSS pixels.
function dsResize(){
  var rect=dsCv.parentElement.getBoundingClientRect();
  var dpr=window.devicePixelRatio||1;
  dsCv.width=rect.width*dpr;
  dsCv.height=DS_H*dpr;
  dsCv.style.height=DS_H+'px';
  dsCtx.setTransform(dpr,0,0,dpr,0,0);
}
dsResize();
window.addEventListener('resize',function(){dsResize();drawDopeSheet();});

// Coordinate mappings between curve space (t,v in [0,1]) and canvas pixels.
// tToX/vToY project a point onto the plot; xToT/yToV invert a pointer position.
function dsW(){return dsCv.width/(window.devicePixelRatio||1);}
function tToX(t){return DS_PAD.l+t*(dsW()-DS_PAD.l-DS_PAD.r);}
function vToY(v){return DS_PAD.t+(1-v)*(DS_H-DS_PAD.t-DS_PAD.b);}
function xToT(x){return Math.max(0,Math.min(1,(x-DS_PAD.l)/(dsW()-DS_PAD.l-DS_PAD.r)));}
function yToV(y){return Math.max(0,Math.min(1,1-(y-DS_PAD.t)/(DS_H-DS_PAD.t-DS_PAD.b)));}

// Repaint the whole dope sheet: grid, axis labels, playhead, and each visible
// curve with its sampled line, current-value dot, readout, and control points.
function drawDopeSheet(){
  var w=dsW(), h=DS_H;
  var ctx=dsCtx;
  ctx.clearRect(0,0,w,h);

  // Background
  ctx.fillStyle='rgba(14,17,24,0.95)';
  ctx.fillRect(0,0,w,h);

  // Grid
  ctx.strokeStyle='rgba(150,200,255,0.04)';
  ctx.lineWidth=1;
  for(var i=0;i<=10;i++){
    var x=tToX(i/10);
    ctx.beginPath();ctx.moveTo(x,DS_PAD.t);ctx.lineTo(x,h-DS_PAD.b);ctx.stroke();
  }
  for(var j=0;j<=4;j++){
    var y=vToY(j/4);
    ctx.beginPath();ctx.moveTo(DS_PAD.l,y);ctx.lineTo(w-DS_PAD.r,y);ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle='rgba(150,200,255,0.15)';
  ctx.font='8px monospace';
  ctx.textAlign='center';
  for(var i=0;i<=10;i++){
    ctx.fillText((i/10*duration).toFixed(1)+'s',tToX(i/10),h-DS_PAD.b+12);
  }
  ctx.textAlign='right';
  ctx.fillText('1.0',DS_PAD.l-4,DS_PAD.t+4);
  ctx.fillText('0.5',DS_PAD.l-4,vToY(0.5)+3);
  ctx.fillText('0.0',DS_PAD.l-4,h-DS_PAD.b+3);

  // Playhead
  var px=tToX(currentTime/duration);
  ctx.strokeStyle='rgba(150,200,255,0.3)';
  ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(px,DS_PAD.t);ctx.lineTo(px,h-DS_PAD.b);ctx.stroke();
  ctx.fillStyle='var(--blue)';
  ctx.beginPath();ctx.moveTo(px-4,DS_PAD.t-2);ctx.lineTo(px+4,DS_PAD.t-2);ctx.lineTo(px,DS_PAD.t+4);ctx.fill();

  // Draw each curve
  var names=['scale','bright','density'];
  for(var ci=0;ci<names.length;ci++){
    var name=names[ci];
    var c=CURVES[name];
    if(!c.visible)continue;
    var pts=c.points;
    if(pts.length<2)continue;

    // Curve line — sample at many points
    ctx.strokeStyle=c.color;
    ctx.lineWidth=2;
    ctx.globalAlpha=0.8;
    ctx.beginPath();
    for(var s=0;s<=200;s++){
      var tn=s/200;
      var v=evalCurve(pts,tn);
      var x=tToX(tn),y=vToY(v);
      if(s===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.globalAlpha=1;

    // Current value indicator
    var curV=evalCurve(pts,currentTime/duration);
    var curX=tToX(currentTime/duration), curY=vToY(curV);
    ctx.fillStyle=c.color;
    ctx.beginPath();ctx.arc(curX,curY,4,0,Math.PI*2);ctx.fill();

    // Value readout
    var realVal=c.min+curV*(c.max-c.min);
    ctx.fillStyle=c.color;
    ctx.font='9px monospace';
    ctx.textAlign='left';
    ctx.fillText(c.label+':'+realVal.toFixed(2), DS_PAD.l+4, DS_PAD.t+12+ci*12);

    // Control points
    for(var pi=0;pi<pts.length;pi++){
      var x=tToX(pts[pi].t), y=vToY(pts[pi].v);
      var isHover=dsHover&&dsHover.curve===name&&dsHover.idx===pi;
      var isDrag=dsDragging&&dsDragging.curve===name&&dsDragging.idx===pi;
      ctx.fillStyle=isDrag?'#fff':isHover?c.color:'rgba(255,255,255,0.6)';
      ctx.strokeStyle=c.color;
      ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.rect(x-4,y-4,8,8);
      ctx.fill();ctx.stroke();
    }
  }
}

// Return the visible control point nearest the pointer within 12px, or null.
// Dope sheet interaction
function dsHitTest(mx,my){
  var names=['scale','bright','density'];
  var best=null, bestD=Infinity;
  for(var ci=0;ci<names.length;ci++){
    var c=CURVES[names[ci]];
    if(!c.visible)continue;
    for(var pi=0;pi<c.points.length;pi++){
      var x=tToX(c.points[pi].t), y=vToY(c.points[pi].v);
      var d=Math.hypot(mx-x,my-y);
      if(d<12&&d<bestD){bestD=d;best={curve:names[ci],idx:pi};}
    }
  }
  return best;
}

// Dope-sheet press: right-click removes an interior point, left-click either
// grabs the point under the pointer or adds a new point to the nearest curve.
dsCv.addEventListener('mousedown',function(e){
  var rect=dsCv.getBoundingClientRect();
  var mx=e.clientX-rect.left, my=e.clientY-rect.top;
  var hit=dsHitTest(mx,my);

  if(e.button===2){
    // Right click — remove point (but not first/last)
    e.preventDefault();
    if(hit){
      var pts=CURVES[hit.curve].points;
      if(hit.idx>0&&hit.idx<pts.length-1){
        pts.splice(hit.idx,1);
        drawDopeSheet();
      }
    }
    return;
  }

  // Point hit: start dragging it.
  if(hit){
    dsDragging=hit;
  } else {
    // Click on empty space — add point to nearest visible curve
    var t=xToT(mx), v=yToV(my);
    var names=['scale','bright','density'];
    var bestName=null, bestDist=Infinity;
    for(var ci=0;ci<names.length;ci++){
      var c=CURVES[names[ci]];
      if(!c.visible)continue;
      var cv=evalCurve(c.points,t);
      var cy=vToY(cv);
      var d=Math.abs(my-cy);
      if(d<bestDist){bestDist=d;bestName=names[ci];}
    }
    if(bestName){
      var pts=CURVES[bestName].points;
      pts.push({t:t,v:v});
      pts.sort(function(a,b){return a.t-b.t;});
      var newIdx=pts.findIndex(function(p){return p.t===t&&p.v===v;});
      dsDragging={curve:bestName,idx:newIdx};
      drawDopeSheet();
    }
  }
});
dsCv.addEventListener('contextmenu',function(e){e.preventDefault();});

// Dope-sheet drag/hover: move the grabbed point (endpoints keep their t and
// interior points stay between their neighbours), else update the hover state.
document.addEventListener('mousemove',function(e){
  var rect=dsCv.getBoundingClientRect();
  var mx=e.clientX-rect.left, my=e.clientY-rect.top;
  if(dsDragging){
    var pts=CURVES[dsDragging.curve].points;
    var pt=pts[dsDragging.idx];
    var newT=xToT(mx), newV=yToV(my);
    // First and last points: lock t
    if(dsDragging.idx===0)newT=0;
    if(dsDragging.idx===pts.length-1)newT=1;
    // Clamp between neighbors
    if(dsDragging.idx>0)newT=Math.max(pts[dsDragging.idx-1].t+0.005,newT);
    if(dsDragging.idx<pts.length-1)newT=Math.min(pts[dsDragging.idx+1].t-0.005,newT);
    pt.t=newT; pt.v=newV;
    drawDopeSheet();
  } else {
    var hit=dsHitTest(mx,my);
    if((hit&&!dsHover)||(!hit&&dsHover)||(hit&&dsHover&&(hit.curve!==dsHover.curve||hit.idx!==dsHover.idx))){
      dsHover=hit;
      dsCv.style.cursor=hit?'grab':'crosshair';
      drawDopeSheet();
    }
  }
});
document.addEventListener('mouseup',function(){
  if(dsDragging){dsDragging=null;dsCv.style.cursor='crosshair';}
});

// ═══════════════════════════════════════════════════════════
// WGSL
// ═══════════════════════════════════════════════════════════
// WGSL shader source, fetched from shaders/explosion.wgsl at init.
var WGSL='';

// ═══════════════════════════════════════════════════════════
// Noise texture
// ═══════════════════════════════════════════════════════════
// Build a 256x256 RGBA noise texture with a Park-Miller LCG. The shader's
// value-noise function samples this instead of computing hashes on the GPU.
function makeNoiseTex(){var S=256,data=new Uint8Array(S*S*4),s=48271;for(var i=0;i<S*S*4;i++){s=(s*16807)%2147483647;data[i]=(s>>>16)&0xFF;}return{data:data,size:S};}

// ═══════════════════════════════════════════════════════════
// WebGPU
// ═══════════════════════════════════════════════════════════
// WebGPU bring-up. Each step logs a numbered marker so a failure point is
// visible in the debug overlay. It fetches the shader, requests the device,
// compiles the module (reporting any WGSL diagnostics), then builds the
// noise texture, uniform buffer, pipeline, and bind group before the loop.
(async function(){try{
  // Fetch the shader source relative to this page.
  WGSL = await (await fetch(new URL('shaders/explosion.wgsl', document.baseURI))).text();
  dbg('1:gpu');
  // Feature-detect WebGPU.
  if(!navigator.gpu){dbg('NO GPU');return;}
  dbg('2:adapter');
  // Request a GPU adapter (physical device).
  var adapter=await navigator.gpu.requestAdapter();
  if(!adapter){dbg('NO ADAPTER');return;}
  dbg('3:device');
  // Open a logical device for creating resources.
  var device=await adapter.requestDevice();
  // The tab shell removes this iframe on a page swap. Release the device so
  // the renderer does not run out of GPU memory during heavy swapping.
  window.addEventListener('pagehide',function(){try{device.destroy();}catch(e){}});
  dbg('4:shader');
  var format=navigator.gpu.getPreferredCanvasFormat();
  // Compile the WGSL module and surface any compile errors before continuing.
  var shaderModule=device.createShaderModule({code:WGSL});
  var info=await shaderModule.getCompilationInfo();
  for(var j=0;j<info.messages.length;j++){var m=info.messages[j];dbg('WGSL '+m.type+':'+m.message+' line:'+m.lineNum);if(m.type==='error')return;}
  dbg('5:tex');
  // Upload the noise texture and a linear-repeat sampler for the shader.
  var nd=makeNoiseTex();
  var noiseTexture=device.createTexture({size:[nd.size,nd.size],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture:noiseTexture},nd.data,{bytesPerRow:nd.size*4},[nd.size,nd.size]);
  var noiseSampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'});
  dbg('6:pipeline');
  // 48-byte uniform buffer: matches the 12-float Uniforms struct in the shader.
  var uniformBuf=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  // Bind group layout: uniforms + noise texture + sampler, all fragment-visible.
  var bgl=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
    {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
    {binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
  ]});
  // Render pipeline: vs() emits the full-screen triangle, fs() shades it.
  var pipeline=device.createRenderPipeline({
    layout:device.createPipelineLayout({bindGroupLayouts:[bgl]}),
    vertex:{module:shaderModule,entryPoint:'vs'},
    fragment:{module:shaderModule,entryPoint:'fs',targets:[{format:format}]},
    primitive:{topology:'triangle-list'},
  });
  dbg('7:canvas');
  // Configure the canvas as a WebGPU target and bind the resources.
  var ctx=cv.getContext('webgpu');
  ctx.configure({device:device,format:format,alphaMode:'opaque'});
  var bindGroup=device.createBindGroup({layout:bgl,entries:[
    {binding:0,resource:{buffer:uniformBuf}},
    {binding:1,resource:noiseTexture.createView()},
    {binding:2,resource:noiseSampler},
  ]});
  // Match the canvas backing store to its CSS size times a quality-capped DPR,
  // so higher quality tiers render at more pixels. Updates the resolution label.
  function resize(){
    var dpr=Math.min(window.devicePixelRatio,quality===0?1:quality===1?1.5:2);
    var rect=cv.getBoundingClientRect();var w=Math.floor(rect.width*dpr),h=Math.floor(rect.height*dpr);
    if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;document.getElementById('resLabel').textContent=w+'x'+h;}
  }
  new ResizeObserver(resize).observe(cv);resize();
  dbg('8:go');dbgEl.style.display='none';
  updPlayBtn();drawDopeSheet();

  // Per-frame update and draw. Advances time, samples the curves, writes the
  // uniform buffer, and submits one render pass drawing the full-screen triangle.
  function frame(ts){try{
    // Real elapsed seconds; advance and loop the playhead unless scrubbing.
    var dt=lastTs?(ts-lastTs)/1000:0.016;lastTs=ts;
    if(playing&&!scrubbing){currentTime+=dt*speed;if(currentTime>duration)currentTime=0;}
    frames++;fpsTime+=dt;
    if(fpsTime>=1){document.getElementById('fpsLabel').textContent=Math.round(frames/fpsTime)+' FPS';frames=0;fpsTime=0;}
    document.getElementById('timeNow').textContent=currentTime.toFixed(2);
    tlFill.style.width=(currentTime/duration*100)+'%';
    drawDopeSheet();
    resize();

    // Sample the three animation curves at the normalized playhead time.
    var tN=currentTime/duration;
    var curScale=getCurveValue('scale',tN);
    var curBright=getCurveValue('bright',tN);
    var curDensity=getCurveValue('density',tN);

    // Pack the uniforms in the shader's field order (resolution, time, mouseX,
    // zoom, density_scale, quality, brightness, seed, scale) and upload them.
    var ud=new Float32Array(12);
    ud[0]=cv.width;ud[1]=cv.height;ud[2]=Math.max(0,currentTime);ud[3]=mouseX;
    ud[4]=zoom;ud[5]=curDensity;ud[6]=quality;ud[7]=curBright;ud[8]=seed;ud[9]=curScale;
    device.queue.writeBuffer(uniformBuf,0,ud);

    // Record and submit one render pass: clear, draw the triangle, present.
    var encoder=device.createCommandEncoder();
    var pass=encoder.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }catch(e){dbg('FRAME:'+e.message+'\n'+e.stack);}}
  requestAnimationFrame(frame);
}catch(e){dbg('INIT:'+e.message+'\n'+e.stack);}})();
