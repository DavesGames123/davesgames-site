// ============================================================================
//  MAGNETLAB  ·  tracer WebGL draw  (part 9 of 20)
// ----------------------------------------------------------------------------
//  The hidden WebGL canvas, its program and buffers, the vertex fill from
//  the trail rings, and the one instanced draw. renderTracers() is the
//  tracer layer entry point and falls back to tracer-2d.js.
//
//  grep -n targets: "const glCanvas", "function initTracerGL", "function fillTracerVerts",
//                   "function renderTracersGL", "function renderTracers"
// ============================================================================

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
